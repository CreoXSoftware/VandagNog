import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download, Upload } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useTasksData, type TasksPerson } from '@/hooks/useTasksData';
import { useGlobalWorkItemsRealtime } from '@/hooks/useGlobalWorkItemsRealtime';
import { useDeleteWorkItem, useRestoreWorkItem, useUpdateWorkItem } from '@/hooks/useWorkItems';
import { TaskFilters, UNASSIGNED } from '@/components/tasks/TaskFilters';
import { TaskRow } from '@/components/tasks/TaskRow';
import { QuickAddRow } from '@/components/tasks/QuickAddRow';
import { TaskDrawerHost } from '@/components/tasks/TaskDrawerHost';
import { JsonSyncDialog } from '@/components/tasks/JsonSyncDialog';
import { Button } from '@/components/ui/Button';
import {
  bucketOf,
  rangeFor,
  todayIso,
  BUCKET_ORDER,
  type TaskBucket,
  type TimeFilter,
} from '@/lib/tasksFilter';
import type { WorkCalendar } from '@/components/gantt/ganttUtils';
import { ancestorChain, collectSubtreeIds, indexById, leafIds } from '@/lib/workItemTree';
import { itemStatus } from '@/components/gantt/filterLogic';
import { siblingCompare } from '@/lib/levels';
import { avatarHue } from '@/lib/userDisplay';
import { exportWorkspaceJson } from '@/lib/bulkExport';
import { loadTasksPrefs, saveTasksPrefs } from '@/lib/tasksPrefs';
import type { WorkItem } from '@/types/db';

interface Row {
  item: WorkItem;
  bucket: TaskBucket;
  /** Set on the first row of each bucket, so the list can print a subheader. */
  headerBucket: TaskBucket | null;
  breadcrumb: string[];
  isMine: boolean;
}

interface Group {
  projectId: string;
  projectName: string;
  rows: Row[];
  openCount: number;
  doneCount: number;
  rootPositions: number[];
  canEdit: boolean;
  /** Who a task quick-added into this group is assigned to. */
  quickAddAssigneeId: string | null;
}

export function TasksPage() {
  const t = useT();
  const search = useSearch({ from: '/_app/tasks' });
  const nav = useNavigate();

  const { data, isLoading, error } = useTasksData();
  useGlobalWorkItemsRealtime();

  const update = useUpdateWorkItem();
  const del = useDeleteWorkItem();
  const restore = useRestoreWorkItem();

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
  const [syncOpen, setSyncOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(prefs0.collapsed));

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
      collapsed: Array.from(collapsed),
    });
  }, [when, projectIds, assigneeSel, statuses, searchText, showDone, hideEmpty, collapsed]);

  // Ticking a task normally filters it straight out of view, which makes the
  // click feel like the row vanished rather than completed. Keep just-ticked ids
  // visible (struck through) until the filters change.
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
  const [done, setDone] = useState<{ sig: string; ids: Set<string> }>({
    sig: filterSig,
    ids: new Set(),
  });
  if (done.sig !== filterSig) setDone({ sig: filterSig, ids: new Set() });
  const justDone = done.ids;

  const peopleById = useMemo(
    () => new Map((data?.people ?? []).map((p) => [p.user_id, p])),
    [data?.people],
  );

  const groups: Group[] = useMemo(() => {
    if (!data) return [];

    const byId = indexById(data.items);
    // Summary rows have their dates and progress recomputed from their children
    // by the work_items_rollup trigger, so ticking one is a lie that silently
    // reverts. Only leaves are listed; ancestors show up as breadcrumb text.
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

    const byProject = new Map<string, Row[]>();
    const counts = new Map<string, { open: number; done: number }>();

    for (const item of data.items) {
      if (!leaves.has(item.id)) continue;
      if (projectSet.size > 0 && !projectSet.has(item.project_id)) continue;

      if (assigneeSet.size > 0) {
        if (!assigneeSet.has(item.assignee_id ?? UNASSIGNED)) continue;
      }
      if (statusSet.size > 0 && !itemStatus(item, today).some((s) => statusSet.has(s))) continue;

      const chain = ancestorChain(byId, item);
      if (q) {
        const hay = [item.name, ...chain.map((c) => c.name)].join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const bucket = bucketOf(item, today, range);
      if (!bucket) continue;

      const tally = counts.get(item.project_id) ?? { open: 0, done: 0 };
      if (bucket === 'done') tally.done += 1;
      else tally.open += 1;
      counts.set(item.project_id, tally);

      if (bucket === 'done' && !showDone && !justDone.has(item.id)) continue;

      const arr = byProject.get(item.project_id) ?? [];
      arr.push({
        item,
        bucket,
        headerBucket: null, // assigned after the group is sorted
        breadcrumb: chain.map((c) => c.name),
        isMine: !!me && item.assignee_id === me,
      });
      byProject.set(item.project_id, arr);
    }

    const rootPositionsByProject = new Map<string, number[]>();
    for (const w of data.items) {
      if (w.parent_id) continue;
      const arr = rootPositionsByProject.get(w.project_id) ?? [];
      arr.push(w.position);
      rootPositionsByProject.set(w.project_id, arr);
    }

    const bucketRank = new Map(BUCKET_ORDER.map((b, i) => [b, i]));

    const out: Group[] = [];
    for (const p of data.projects) {
      if (projectSet.size > 0 && !projectSet.has(p.id)) continue;
      const rows = byProject.get(p.id) ?? [];
      // By default every project you can see gets a group, even with nothing in
      // scope — that is what keeps its quick-add row reachable. Turning this on
      // trades that away for a shorter list.
      if (hideEmpty && rows.length === 0) continue;

      rows.sort((a, b) => {
        if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
        const br = bucketRank.get(a.bucket)! - bucketRank.get(b.bucket)!;
        if (br !== 0) return br;
        const ae = a.item.end_date ?? '';
        const be = b.item.end_date ?? '';
        if (ae !== be) return ae < be ? -1 : 1;
        return siblingCompare(a.item, b.item);
      });

      // Bucket subheaders only earn their space when the group spans more than
      // one bucket.
      if (new Set(rows.map((r) => r.bucket)).size > 1) {
        let last: TaskBucket | null = null;
        for (const r of rows) {
          r.headerBucket = r.bucket === last ? null : r.bucket;
          last = r.bucket;
        }
      }

      const tally = counts.get(p.id) ?? { open: 0, done: 0 };
      out.push({
        projectId: p.id,
        projectName: p.name,
        rows,
        openCount: tally.open,
        doneCount: tally.done,
        rootPositions: rootPositionsByProject.get(p.id) ?? [],
        canEdit: data.editableProjectIds.has(p.id),
        quickAddAssigneeId: quickAddAssignee(p.id),
      });
    }
    return out;
  }, [data, me, projectIds, assigneeIds, statuses, searchText, showDone, hideEmpty, justDone, range, today]);

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

  function toggle(item: WorkItem, isDone: boolean) {
    setDone((prev) => {
      const ids = new Set(prev.ids);
      if (isDone) ids.add(item.id);
      else ids.delete(item.id);
      return { sig: prev.sig, ids };
    });
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
      <div className="px-4 pt-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t('tasks.title')}</h1>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {t('tasks.subtitle')}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={exportAll} disabled={!data}>
            <Download size={13} />
            {t('tasks.export')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)} disabled={!data}>
            <Upload size={13} />
            {t('tasks.sync.open')}
          </Button>
        </div>
      </div>

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
        />
      </div>

      {/* data-keep-drawer: Drawer closes on any outside pointerdown, so without
          this, ticking a checkbox or switching tasks would dismiss it. */}
      <div
        data-keep-drawer
        className="flex-1 min-h-0 overflow-y-auto border-t border-neutral-200 dark:border-neutral-800"
      >
        {isLoading ? (
          <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">
            {t('common.loading')}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{t('tasks.loadError')}</div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('tasks.empty')}</div>
        ) : (
          groups.map((g) => (
            <ProjectGroup
              key={g.projectId}
              group={g}
              collapsed={collapsed.has(g.projectId)}
              onToggleCollapse={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.projectId)) next.delete(g.projectId);
                  else next.add(g.projectId);
                  return next;
                })
              }
              today={today}
              when={when}
              selectedId={search.item}
              peopleById={peopleById}
              calendar={data!.calendarByProject.get(g.projectId)}
              onToggle={toggle}
              onOpen={(item) => select(item.id)}
              onDelete={remove}
            />
          ))
        )}
      </div>

      {selected && (
        <TaskDrawerHost
          item={selected}
          canEdit={!!data?.editableProjectIds.has(selected.project_id)}
          onClose={() => select(undefined)}
          onNavigate={(id) => select(id)}
        />
      )}

      {data && <JsonSyncDialog open={syncOpen} onOpenChange={setSyncOpen} data={data} />}
    </div>
  );
}

function ProjectGroup({
  group,
  collapsed,
  onToggleCollapse,
  today,
  when,
  selectedId,
  peopleById,
  calendar,
  onToggle,
  onOpen,
  onDelete,
}: {
  group: Group;
  collapsed: boolean;
  onToggleCollapse: () => void;
  today: string;
  when: TimeFilter;
  selectedId: string | undefined;
  peopleById: Map<string, TasksPerson>;
  calendar: WorkCalendar | undefined;
  onToggle: (item: WorkItem, done: boolean) => void;
  onOpen: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
}) {
  const t = useT();
  const hue = avatarHue(group.projectId);

  return (
    <section className="border-b border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-3 h-10 bg-neutral-50 dark:bg-neutral-900/70 hover:bg-neutral-100 dark:hover:bg-neutral-900 sticky top-0 z-10"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
        />
        <span className="text-sm font-medium truncate">{group.projectName}</span>
        <span className="ml-auto text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {t('tasks.openCount', { n: group.openCount })}
          {group.doneCount > 0 && ` · ${t('tasks.doneCount', { n: group.doneCount })}`}
        </span>
      </button>

      {!collapsed && (
        <>
          {group.rows.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-neutral-400 dark:text-neutral-500">
              {t('tasks.emptyProject')}
            </div>
          )}
          {group.rows.map((r) => {
            return (
              <div key={r.item.id}>
                {r.headerBucket && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    {t(`tasks.bucket.${r.headerBucket}` as const)}
                  </div>
                )}
                <TaskRow
                  item={r.item}
                  breadcrumb={r.breadcrumb}
                  assignee={r.item.assignee_id ? peopleById.get(r.item.assignee_id) : undefined}
                  isMine={r.isMine}
                  canEdit={group.canEdit}
                  today={today}
                  selected={selectedId === r.item.id}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
          {group.canEdit && calendar && (
            <QuickAddRow
              projectId={group.projectId}
              rootPositions={group.rootPositions}
              calendar={calendar}
              when={when}
              today={today}
              assigneeId={group.quickAddAssigneeId}
            />
          )}
        </>
      )}
    </section>
  );
}
