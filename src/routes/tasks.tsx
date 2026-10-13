import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Download, ListTree, Trash2, Upload } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useTasksData } from '@/hooks/useTasksData';
import { useGlobalWorkItemsRealtime } from '@/hooks/useGlobalWorkItemsRealtime';
import { useDeleteWorkItem, useRestoreWorkItem, useUpdateWorkItem } from '@/hooks/useWorkItems';
import { useDeletedWorkItems } from '@/hooks/useDeletedWorkItems';
import { TaskFilters, UNASSIGNED } from '@/components/tasks/TaskFilters';
import { TaskOutline, type OutlineGroup } from '@/components/tasks/TaskOutline';
import { TaskTrash } from '@/components/tasks/TaskTrash';
import { TaskDrawerHost } from '@/components/tasks/TaskDrawerHost';
import { JsonSyncDialog } from '@/components/tasks/JsonSyncDialog';
import { Button } from '@/components/ui/Button';
import { bucketOf, rangeFor, todayIso } from '@/lib/tasksFilter';
import { ancestorChain, collectSubtreeIds, indexById, leafIds } from '@/lib/workItemTree';
import { withAncestors } from '@/lib/taskOutline';
import { itemStatus } from '@/components/gantt/filterLogic';
import { exportWorkspaceJson } from '@/lib/bulkExport';
import { loadTasksPrefs, saveTasksPrefs } from '@/lib/tasksPrefs';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/types/db';

export function TasksPage() {
  const t = useT();
  const search = useSearch({ from: '/_app/tasks' });
  const nav = useNavigate();

  const { data, isLoading, error } = useTasksData();
  useGlobalWorkItemsRealtime();
  const { entries: trashEntries } = useDeletedWorkItems(data?.items);

  const update = useUpdateWorkItem();
  const del = useDeleteWorkItem();
  const restore = useRestoreWorkItem();

  const view = search.view === 'trash' ? 'trash' : 'list';

  // Read once, lazily. The URL still wins when it carries a time filter, so a
  // shared link keeps working; arriving from the sidebar (no search params)
  // falls back to whatever was last used.
  const [prefs0] = useState(loadTasksPrefs);

  const when = search.when ?? prefs0.when;
  const today = useMemo(() => todayIso(), []);
  const range = useMemo(() => rangeFor(when, today), [when, today]);

  const [projectIds, setProjectIds] = useState<string[]>(prefs0.projectIds);
  // null = never touched, which resolves to "just me" below.
  const [assigneeSel, setAssigneeSel] = useState<string[] | null>(prefs0.assigneeIds);
  const [statuses, setStatuses] = useState<string[]>(prefs0.statuses);
  const [searchText, setSearchText] = useState(prefs0.search);
  const [showDone, setShowDone] = useState(prefs0.showDone);
  const [hideEmpty, setHideEmpty] = useState(prefs0.hideEmpty);
  const [showDescriptions, setShowDescriptions] = useState(prefs0.showDescriptions);
  // The task whose description the details panel should put the cursor in
  // once it is showing (a click on the description in the outline).
  const [focusDescFor, setFocusDescFor] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(prefs0.collapsed));
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(
    new Set(prefs0.collapsedItems),
  );

  const me = data?.currentUserId ?? null;

  // The default view is your own work. Resolving null -> [me] at use time rather
  // than seeding the state means no effect and no frame showing everyone's tasks
  // before the current user id arrives with the query.
  const assigneeIds = useMemo(() => assigneeSel ?? (me ? [me] : []), [assigneeSel, me]);

  // "Only mine" is not separate state — it is a shortcut that writes the
  // assignee filter, so the two can never disagree.
  const mineOnly = !!me && assigneeIds.length === 1 && assigneeIds[0] === me;
  function setMineOnly(v: boolean) {
    setAssigneeSel(v && me ? [me] : []);
  }

  useEffect(() => {
    saveTasksPrefs({
      when,
      projectIds,
      assigneeIds: assigneeSel,
      statuses,
      search: searchText,
      showDone,
      hideEmpty,
      showDescriptions,
      collapsed: Array.from(collapsed),
      collapsedItems: Array.from(collapsedItems),
    });
  }, [when, projectIds, assigneeSel, statuses, searchText, showDone, hideEmpty, showDescriptions, collapsed, collapsedItems]);

  // Anything you just created, renamed, ticked, re-assigned or moved stays on
  // screen even if it no longer matches the filters — otherwise typing a task
  // that is not "today" or not yours would make it vanish under the cursor.
  // The pins are dropped when the filters change.
  //
  // Reset during render rather than in an effect: an effect would paint one
  // frame with the stale set before clearing it.
  const filterSig = JSON.stringify([
    when,
    projectIds,
    assigneeIds,
    statuses,
    searchText,
    showDone,
  ]);
  const [pins, setPins] = useState<{ sig: string; ids: Set<string> }>({
    sig: filterSig,
    ids: new Set(),
  });
  if (pins.sig !== filterSig) setPins({ sig: filterSig, ids: new Set() });
  const pinned = pins.ids;

  function pin(ids: string[]) {
    setPins((prev) => {
      if (ids.every((id) => prev.ids.has(id))) return prev;
      const next = new Set(prev.ids);
      for (const id of ids) next.add(id);
      return { sig: prev.sig, ids: next };
    });
  }

  const peopleById = useMemo(
    () => new Map((data?.people ?? []).map((p) => [p.user_id, p])),
    [data?.people],
  );

  const groups: OutlineGroup[] = useMemo(() => {
    if (!data) return [];

    const byId = indexById(data.items);
    // Filters judge leaves: summary rows take their dates, progress and (by
    // convention) relevance from their children, and are shown as the context
    // of whatever matches beneath them.
    const leaves = leafIds(data.items);

    const projectSet = new Set(projectIds);
    const assigneeSet = new Set(assigneeIds);
    const statusSet = new Set(statuses);
    const q = searchText.trim().toLowerCase();

    // When exactly one person is filtered for, a task added here should land on
    // them rather than on you.
    const singleAssignee = assigneeIds.length === 1 ? assigneeIds[0] : null;
    function quickAddAssignee(projectId: string): string | null {
      const members = data!.membership[projectId] ?? [];
      if (singleAssignee === UNASSIGNED) return null;
      if (singleAssignee && members.includes(singleAssignee)) return singleAssignee;
      // enforce_assignee_membership rejects a non-member, so only fall back to
      // yourself where you actually belong to the project.
      return me && members.includes(me) ? me : null;
    }

    const itemsByProject = new Map<string, WorkItem[]>();
    const matchedByProject = new Map<string, Set<string>>();
    const counts = new Map<string, { open: number; done: number }>();
    const matchedIn = (projectId: string) => {
      let s = matchedByProject.get(projectId);
      if (!s) matchedByProject.set(projectId, (s = new Set()));
      return s;
    };

    for (const item of data.items) {
      const arr = itemsByProject.get(item.project_id);
      if (arr) arr.push(item);
      else itemsByProject.set(item.project_id, [item]);

      if (pinned.has(item.id)) matchedIn(item.project_id).add(item.id);

      if (!leaves.has(item.id)) continue;
      if (projectSet.size > 0 && !projectSet.has(item.project_id)) continue;
      if (assigneeSet.size > 0 && !assigneeSet.has(item.assignee_id ?? UNASSIGNED)) continue;
      if (statusSet.size > 0 && !itemStatus(item, today).some((s) => statusSet.has(s))) continue;
      if (q) {
        const chain = ancestorChain(byId, item);
        const hay = [item.name, ...chain.map((c) => c.name)].join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const bucket = bucketOf(item, today, range);
      if (!bucket) continue;

      const tally = counts.get(item.project_id) ?? { open: 0, done: 0 };
      if (bucket === 'done') tally.done += 1;
      else tally.open += 1;
      counts.set(item.project_id, tally);

      if (bucket === 'done' && !showDone) continue;
      matchedIn(item.project_id).add(item.id);
    }

    const out: OutlineGroup[] = [];
    for (const p of data.projects) {
      if (projectSet.size > 0 && !projectSet.has(p.id)) continue;
      const items = itemsByProject.get(p.id) ?? [];
      const visible = withAncestors(items, matchedByProject.get(p.id) ?? new Set());
      // Default: only projects with something in scope. Turning this off shows
      // every project you can see, which is how you reach the add-a-task row of
      // a project that has nothing scheduled.
      if (hideEmpty && visible.size === 0) continue;

      const tally = counts.get(p.id) ?? { open: 0, done: 0 };
      out.push({
        projectId: p.id,
        projectName: p.name,
        items,
        visible,
        openCount: tally.open,
        doneCount: tally.done,
        canEdit: data.editableProjectIds.has(p.id),
        quickAddAssigneeId: quickAddAssignee(p.id),
        calendar: data.calendarByProject.get(p.id),
      });
    }
    return out;
  }, [data, me, projectIds, assigneeIds, statuses, searchText, showDone, hideEmpty, pinned, range, today]);

  const trashCount = useMemo(() => {
    if (!trashEntries || !data) return 0;
    const ids = new Set(data.projects.map((p) => p.id));
    return trashEntries.filter((e) => ids.has(e.root.item.project_id)).length;
  }, [trashEntries, data]);

  const selected = useMemo(
    () => (search.item ? data?.items.find((w) => w.id === search.item) : undefined),
    [search.item, data?.items],
  );

  function setWhen(w: typeof when) {
    nav({ to: '/tasks', search: { ...search, when: w } });
  }
  function select(id: string | undefined) {
    nav({ to: '/tasks', search: { ...search, item: id } });
  }
  function setView(v: 'list' | 'trash') {
    nav({ to: '/tasks', search: { ...search, view: v === 'trash' ? 'trash' : undefined, item: undefined } });
  }

  function toggle(item: WorkItem, isDone: boolean) {
    pin([item.id]);
    update.mutate(
      { id: item.id, project_id: item.project_id, patch: { progress: isDone ? 100 : 0 } },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  function remove(item: WorkItem) {
    if (!data) return;
    // soft_delete_work_item is recursive — say so before it happens.
    const n = collectSubtreeIds(data.items, item.id).size - 1;
    const message =
      n > 0
        ? t('tasks.deleteConfirmSubtree', { name: item.name, n })
        : t('tasks.deleteConfirm', { name: item.name });
    if (!confirm(message)) return;

    del.mutate(
      { id: item.id, project_id: item.project_id },
      {
        onSuccess: () => {
          if (search.item === item.id) select(undefined);
          toast.success(t('tasks.deleted', { name: item.name }), {
            description: t('tasks.deletedHint'),
            action: {
              label: t('tasks.undo'),
              onClick: () =>
                restore.mutate(
                  { id: item.id, project_id: item.project_id },
                  {
                    onSuccess: () => toast.success(t('tasks.restored', { name: item.name })),
                    onError: (e) => toast.error((e as Error).message),
                  },
                ),
            },
          });
        },
        onError: (e) => toast.error((e as Error).message || t('tasks.deleteFailed')),
      },
    );
  }

  function exportAll() {
    if (!data || data.items.length === 0) {
      toast.error(t('tasks.exportEmpty'));
      return;
    }
    // Assignees go out as id + name: the id is authoritative on the way back
    // in, the name is what makes the file editable by hand.
    const nameById = new Map(data.people.map((p) => [p.user_id, p.display_name]));
    exportWorkspaceJson(
      data.projects.map((p) => ({ id: p.id, name: p.name })),
      data.items,
      data.dependencies,
      (userId) => nameById.get(userId),
    );
    toast.success(
      t('tasks.exportDone', { tasks: data.items.length, projects: data.projects.length }),
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">{t('tasks.title')}</h1>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {view === 'trash' ? t('tasks.trash.subtitle') : t('tasks.subtitle')}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5" role="tablist">
            <ViewTab active={view === 'list'} onClick={() => setView('list')}>
              <ListTree size={13} />
              {t('tasks.view.list')}
            </ViewTab>
            <ViewTab active={view === 'trash'} onClick={() => setView('trash')}>
              <Trash2 size={13} />
              {t('tasks.view.trash')}
              {trashCount > 0 && (
                <span className="ml-0.5 rounded-full bg-neutral-200 dark:bg-neutral-700 px-1.5 text-[10px] tabular-nums">
                  {trashCount}
                </span>
              )}
            </ViewTab>
          </div>
          {view === 'list' && (
            <>
              <Button size="sm" variant="outline" onClick={exportAll} disabled={!data}>
                <Download size={13} />
                {t('tasks.export')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)} disabled={!data}>
                <Upload size={13} />
                {t('tasks.sync.open')}
              </Button>
            </>
          )}
        </div>
      </div>

      {view === 'trash' ? (
        <div className="flex-1 min-h-0 mt-3 border-t border-neutral-200 dark:border-neutral-800">
          {isLoading ? (
            <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
          ) : error || !data ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400">{t('tasks.loadError')}</div>
          ) : (
            <TaskTrash data={data} />
          )}
        </div>
      ) : (
        <>
          <div className="px-4 py-3">
            <TaskFilters
              when={when}
              setWhen={setWhen}
              projects={data?.projects ?? []}
              projectIds={projectIds}
              setProjectIds={setProjectIds}
              people={data?.people ?? []}
              assigneeIds={assigneeIds}
              setAssigneeIds={setAssigneeSel}
              statuses={statuses}
              setStatuses={setStatuses}
              search={searchText}
              setSearch={setSearchText}
              mineOnly={mineOnly}
              setMineOnly={setMineOnly}
              showDone={showDone}
              setShowDone={setShowDone}
              hideEmpty={hideEmpty}
              setHideEmpty={setHideEmpty}
              showDescriptions={showDescriptions}
              setShowDescriptions={setShowDescriptions}
            />
          </div>

          {/* The details panel closes on any click outside it, except a click
              that opens another task's row (see ItemRow). */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-neutral-200 dark:border-neutral-800">
            {isLoading ? (
              <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">
                {t('common.loading')}
              </div>
            ) : error ? (
              <div className="p-6 text-sm text-red-600 dark:text-red-400">{t('tasks.loadError')}</div>
            ) : groups.length === 0 ? (
              <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('tasks.empty')}</div>
            ) : (
              <TaskOutline
                groups={groups}
                dependencies={data!.dependencies}
                peopleById={peopleById}
                membership={data!.membership}
                me={me}
                today={today}
                when={when}
                selectedId={search.item}
                collapsedProjects={collapsed}
                onToggleProject={(id) =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                collapsedItems={collapsedItems}
                setCollapsedItems={setCollapsedItems}
                pin={pin}
                showDescriptions={showDescriptions}
                onToggleDone={toggle}
                onOpen={(item, focus) => {
                  setFocusDescFor(focus === 'description' ? item.id : null);
                  select(item.id);
                }}
                onDelete={remove}
              />
            )}
          </div>
        </>
      )}

      {selected && view === 'list' && (
        <TaskDrawerHost
          item={selected}
          canEdit={!!data?.editableProjectIds.has(selected.project_id)}
          focusDescription={focusDescFor === selected.id}
          onDescriptionFocused={() => setFocusDescFor(null)}
          onClose={() => select(undefined)}
          onNavigate={(id) => select(id)}
        />
      )}

      {data && <JsonSyncDialog open={syncOpen} onOpenChange={setSyncOpen} data={data} />}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 h-7 text-xs rounded transition-colors',
        active
          ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
          : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100',
      )}
    >
      {children}
    </button>
  );
}
