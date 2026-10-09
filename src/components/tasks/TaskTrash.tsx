import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronRight,
  FolderKanban,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useI18n, useT } from '@/lib/i18n';
import { avatarHue, displayName } from '@/lib/userDisplay';
import {
  PurgeUnavailableError,
  usePurgeTrashEntries,
  useDeletedWorkItems,
  useRestoreTrashEntries,
  type TrashEntry,
} from '@/hooks/useDeletedWorkItems';
import type { TasksData } from '@/hooks/useTasksData';
import type { WorkItem } from '@/types/db';
import { formatRange } from '@/lib/taskFormat';

const DAY_MS = 86_400_000;

interface Props {
  data: TasksData;
}

// "Recently deleted": every deletion in the projects you belong to, newest
// first, as the user made it — a summary row and the sub-items that went with
// it are one entry, restored together.
export function TaskTrash({ data }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';

  const { entries, byId: deletedById, isLoading, error } = useDeletedWorkItems(data.items);
  const restore = useRestoreTrashEntries();
  const purge = usePurgeTrashEntries();

  const [q, setQ] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const liveById = useMemo(() => new Map(data.items.map((w) => [w.id, w])), [data.items]);
  const peopleById = useMemo(() => new Map(data.people.map((p) => [p.user_id, p])), [data.people]);

  // Entries in projects that are themselves gone (or that you left) are not
  // reachable, so they are not listed.
  const reachable = useMemo(
    () => (entries ?? []).filter((e) => projectById.has(e.root.item.project_id)),
    [entries, projectById],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pset = new Set(projectIds);
    return reachable.filter((e) => {
      if (pset.size > 0 && !pset.has(e.root.item.project_id)) return false;
      if (!needle) return true;
      return [e.root, ...e.descendants.map((d) => d.entry)].some((x) =>
        x.item.name.toLowerCase().includes(needle),
      );
    });
  }, [reachable, q, projectIds]);

  const byDay = useMemo(() => {
    const groups: { day: string; entries: TrashEntry[] }[] = [];
    for (const e of visible) {
      const day = localDay(e.root.deletedAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.entries.push(e);
      else groups.push({ day, entries: [e] });
    }
    return groups;
  }, [visible]);

  const canEdit = (e: TrashEntry) => data.editableProjectIds.has(e.root.item.project_id);
  const selectedEntries = visible.filter((e) => selected.has(e.root.item.id) && canEdit(e));
  const editableVisible = visible.filter(canEdit);
  const allSelected =
    editableVisible.length > 0 && editableVisible.every((e) => selected.has(e.root.item.id));

  // Where the item used to live: project › ancestors, resolving each ancestor
  // from the live tree first and the bin second.
  function locationOf(item: WorkItem): string {
    const names: string[] = [];
    const seen = new Set<string>([item.id]);
    let pid = item.parent_id;
    while (pid && !seen.has(pid)) {
      seen.add(pid);
      const p = liveById.get(pid) ?? deletedById.get(pid)?.item;
      if (!p) break;
      names.unshift(p.name);
      pid = p.parent_id;
    }
    return [projectById.get(item.project_id)?.name ?? '', ...names].filter(Boolean).join(' › ');
  }

  // restore_work_item revives deleted ancestors too (just those rows, not the
  // rest of their deletion), so a restored task is never hidden under a
  // deleted parent. Say so before it happens.
  function revivedAncestors(targets: TrashEntry[]): WorkItem[] {
    const restoring = new Set(targets.map((e) => e.root.item.id));
    const out = new Map<string, WorkItem>();
    for (const e of targets) {
      const seen = new Set<string>();
      let pid = e.root.item.parent_id;
      while (pid && !liveById.has(pid) && !seen.has(pid)) {
        seen.add(pid);
        const parent = deletedById.get(pid)?.item;
        if (!parent) break;
        if (!restoring.has(pid)) out.set(pid, parent);
        pid = parent.parent_id;
      }
    }
    return [...out.values()];
  }

  function doRestore(plan: TrashEntry[]) {
    const extra = revivedAncestors(plan);
    if (extra.length > 0) {
      const names = extra.map((w) => `"${w.name}"`).join(', ');
      if (!confirm(t('tasks.trash.restoreParentsConfirm', { names }))) return;
    }
    const total = plan.reduce((n, p) => n + 1 + p.descendants.length, 0);
    restore.mutate(plan, {
      onSuccess: () => {
        setSelected(new Set());
        toast.success(
          plan.length === 1
            ? t('tasks.trash.restoredOne', { name: plan[0].root.item.name })
            : t('tasks.trash.restoredMany', { n: total }),
          { description: t('tasks.trash.depsNote') },
        );
      },
      onError: (err) => toast.error((err as Error).message || t('tasks.trash.restoreFailed')),
    });
  }

  function doPurge(targets: TrashEntry[]) {
    if (targets.length === 0) return;
    const total = targets.reduce((n, p) => n + 1 + p.descendants.length, 0);
    const message =
      targets.length === 1
        ? t('tasks.trash.purgeConfirmOne', { name: targets[0].root.item.name, n: total - 1 })
        : t('tasks.trash.purgeConfirmMany', { n: total });
    if (!confirm(message)) return;
    purge.mutate(targets, {
      onSuccess: () => {
        setSelected(new Set());
        toast.success(t('tasks.trash.purged', { n: total }));
      },
      onError: (err) =>
        toast.error(
          err instanceof PurgeUnavailableError
            ? t('tasks.trash.purgeUnavailable')
            : (err as Error).message || t('tasks.trash.purgeFailed'),
        ),
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const busy = restore.isPending || purge.isPending;

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b border-neutral-200 dark:border-neutral-800">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 select-none">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={editableVisible.length === 0}
            onChange={(e) =>
              setSelected(
                e.target.checked ? new Set(editableVisible.map((x) => x.root.item.id)) : new Set(),
              )
            }
            className="h-3.5 w-3.5"
          />
          {t('tasks.trash.selectAll')}
        </label>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('tasks.trash.search')}
            className="h-7 w-48 pl-7 pr-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
          />
        </div>
        <MultiSelect
          icon={<FolderKanban size={11} />}
          label={t('tasks.project')}
          items={data.projects.map((p) => ({ id: p.id, label: p.name }))}
          selected={projectIds}
          setSelected={setProjectIds}
          clearLabel={t('tasks.clear')}
          align="start"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={selectedEntries.length === 0 || busy}
            onClick={() => doRestore(selectedEntries)}
          >
            <RotateCcw size={13} />
            {t('tasks.trash.restoreSelected', { n: selectedEntries.length })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedEntries.length === 0 || busy}
            onClick={() => doPurge(selectedEntries)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 size={13} />
            {t('tasks.trash.purgeSelected', { n: selectedEntries.length })}
          </Button>
        </div>
      </div>

      <div className="px-4 py-2 text-[11px] text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800">
        {t('tasks.trash.intro')}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{t('tasks.trash.loadError')}</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <Trash2 size={28} className="mx-auto text-neutral-300 dark:text-neutral-700" />
            <div className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              {reachable.length === 0 ? t('tasks.trash.empty') : t('tasks.trash.noMatches')}
            </div>
          </div>
        ) : (
          byDay.map((group) => (
            <section key={group.day}>
              <div className="px-4 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                {dayLabel(group.day, locale, t)}
              </div>
              {group.entries.map((e) => {
                const id = e.root.item.id;
                const editable = canEdit(e);
                const actor = e.root.deletedBy ? peopleById.get(e.root.deletedBy) : undefined;
                const actorName = e.root.deletedBy
                  ? (actor?.display_name ?? displayName({ user_id: e.root.deletedBy }))
                  : t('tasks.trash.system');
                const open = expanded.has(id);
                const hue = avatarHue(e.root.item.project_id);
                return (
                  <div key={id} className="border-b border-neutral-100 dark:border-neutral-800/60">
                    <div className="group flex items-center gap-2 px-4 min-h-11 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
                      <span className="shrink-0 flex" title={editable ? undefined : t('tasks.readOnly')}>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          disabled={!editable}
                          onChange={() => toggleSelected(id)}
                          aria-label={e.root.item.name}
                          className="h-3.5 w-3.5 disabled:opacity-40"
                        />
                      </span>
                      {e.descendants.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(id)}
                          aria-label={open ? t('tasks.outline.collapse') : t('tasks.outline.expand')}
                          className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                        >
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      ) : (
                        <span className="shrink-0 w-4" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="truncate text-sm">{e.root.item.name}</span>
                          {e.descendants.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(id)}
                              className="shrink-0 text-[10px] rounded px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                            >
                              {t('tasks.trash.withSubtasks', { n: e.descendants.length })}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 min-w-0">
                          <span
                            className="h-2 w-2 rounded-sm shrink-0"
                            style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
                          />
                          <span className="truncate">{locationOf(e.root.item)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 hidden sm:flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {actor ? <Avatar user={actor} size="xs" /> : null}
                        <span className="max-w-[140px] truncate">
                          {t('tasks.trash.deletedBy', { name: actorName })}
                        </span>
                        <span className="tabular-nums">· {timeOf(e.root.deletedAt, locale)}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!editable || busy}
                        onClick={() => doRestore([e])}
                        title={editable ? undefined : t('tasks.readOnly')}
                      >
                        <RotateCcw size={12} />
                        {t('tasks.trash.restore')}
                      </Button>
                      <button
                        type="button"
                        disabled={!editable || busy}
                        onClick={() => doPurge([e])}
                        title={t('tasks.trash.purge')}
                        aria-label={t('tasks.trash.purge')}
                        className="shrink-0 p-1.5 rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {open && (
                      <div className="pb-1.5">
                        {e.descendants.map(({ entry: d, depth }) => {
                          const who = d.item.assignee_id ? peopleById.get(d.item.assignee_id) : undefined;
                          return (
                            <div
                              key={d.item.id}
                              className="flex items-center gap-2 pr-4 h-7 text-xs text-neutral-600 dark:text-neutral-300"
                              style={{ paddingLeft: 56 + (depth - 1) * 18 }}
                            >
                              <span className="h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                              <span className="flex-1 truncate">{d.item.name}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
                                {formatRange(d.item.start_date, d.item.end_date, locale)}
                              </span>
                              {who && <Avatar user={who} size="xs" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(day: string, locale: string, t: ReturnType<typeof useT>): string {
  const now = new Date();
  const today = localDay(now.toISOString());
  const yesterday = localDay(new Date(now.getTime() - DAY_MS).toISOString());
  if (day === today) return t('tasks.trash.today');
  if (day === yesterday) return t('tasks.trash.yesterday');
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function timeOf(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
