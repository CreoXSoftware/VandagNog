import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { ProjectFilters } from '@/components/project/ProjectFilters';
import { CompletedBadge } from '@/components/project/CompletedBadge';
import {
  useCreateProject,
  useDeletedProjects,
  useProjectPrefs,
  useProjects,
  useRestoreProject,
  useSetProjectCompleted,
  useSetProjectPref,
} from '@/hooks/useProjects';
import { useTasksData, type TasksPerson } from '@/hooks/useTasksData';
import { useGlobalWorkItemsRealtime } from '@/hooks/useGlobalWorkItemsRealtime';
import { useAllProjectClients } from '@/hooks/useClients';
import { toast } from 'sonner';
import { cn, formatDate } from '@/lib/utils';
import { parseDate } from '@/components/gantt/ganttUtils';
import { useT } from '@/lib/i18n';
import {
  loadProjectsPrefs,
  NO_CLIENT,
  saveProjectsPrefs,
  type ProjectSort,
} from '@/lib/projectsPrefs';
import { EMPTY_PROJECT_STATS, projectStatsById, type ProjectStats } from '@/lib/projectStats';
import type { Project } from '@/types/db';

interface Row {
  project: Project;
  stats: ProjectStats;
  clientId: string | null;
  clientName: string | null;
  memberIds: string[];
  pinned: boolean;
  hidden: boolean;
  canEdit: boolean;
}

const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareRows(sort: ProjectSort): (a: Row, b: Row) => number {
  const byName = (a: Row, b: Row) => nameCollator.compare(a.project.name, b.project.name);
  // Task edits don't touch projects.updated_at, so activity is whichever of the
  // two is later.
  const activity = (r: Row) =>
    r.stats.lastActivity && r.stats.lastActivity > r.project.updated_at
      ? r.stats.lastActivity
      : r.project.updated_at;
  switch (sort) {
    case 'name_asc':
      return byName;
    case 'name_desc':
      return (a, b) => byName(b, a);
    case 'activity':
      return (a, b) => activity(b).localeCompare(activity(a)) || byName(a, b);
    case 'created_desc':
      return (a, b) => b.project.created_at.localeCompare(a.project.created_at);
    case 'created_asc':
      return (a, b) => a.project.created_at.localeCompare(b.project.created_at);
    case 'finish':
      // Soonest finish first; projects with no dated tasks go last.
      return (a, b) => {
        const fa = a.stats.finish;
        const fb = b.stats.finish;
        if (fa && fb) return fa.localeCompare(fb) || byName(a, b);
        if (fa) return -1;
        if (fb) return 1;
        return byName(a, b);
      };
  }
}

export function ProjectsListPage() {
  const t = useT();
  const { data: projects = [], isLoading } = useProjects();
  // Shared with the Tasks page: one cached fetch of every work item and every
  // project's members, which is what the member, "mine" and progress columns
  // need.
  const { data: tasks, isLoading: tasksLoading } = useTasksData();
  useGlobalWorkItemsRealtime();
  const { data: prefs = [] } = useProjectPrefs();
  const { data: clients } = useAllProjectClients();
  const setPref = useSetProjectPref();
  const setCompleted = useSetProjectCompleted();

  const [prefs0] = useState(loadProjectsPrefs);
  const [status, setStatus] = useState(prefs0.status);
  const [search, setSearch] = useState(prefs0.search);
  const [memberIds, setMemberIds] = useState(prefs0.memberIds);
  const [clientIds, setClientIds] = useState(prefs0.clientIds);
  const [mineOnly, setMineOnly] = useState(prefs0.mineOnly);
  const [showHidden, setShowHidden] = useState(prefs0.showHidden);
  const [sort, setSort] = useState(prefs0.sort);
  const [groupByClient, setGroupByClient] = useState(prefs0.groupByClient);

  useEffect(() => {
    saveProjectsPrefs({ status, search, memberIds, clientIds, mineOnly, showHidden, sort, groupByClient });
  }, [status, search, memberIds, clientIds, mineOnly, showHidden, sort, groupByClient]);

  const me = tasks?.currentUserId ?? null;

  const allRows: Row[] = useMemo(() => {
    const statsById = tasks ? projectStatsById(tasks.items, me) : new Map<string, ProjectStats>();
    const prefById = new Map(prefs.map((p) => [p.project_id, p]));
    return projects.map((p) => {
      const pref = prefById.get(p.id);
      return {
        project: p,
        stats: statsById.get(p.id) ?? EMPTY_PROJECT_STATS,
        clientId: clients?.get(p.id)?.client_id ?? null,
        clientName: clients?.get(p.id)?.client_name ?? null,
        memberIds: tasks?.membership[p.id] ?? [],
        pinned: !!pref?.pinned_at,
        hidden: !!pref?.hidden_at,
        canEdit: tasks?.editableProjectIds.has(p.id) ?? false,
      };
    });
  }, [projects, tasks, me, prefs, clients]);

  const hiddenCount = useMemo(() => allRows.filter((r) => r.hidden).length, [allRows]);

  // Clients of the projects you can see, name-sorted, with "No client" last when
  // any project lacks one.
  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let anyWithout = false;
    for (const r of allRows) {
      if (r.clientId) byId.set(r.clientId, r.clientName ?? '');
      else anyWithout = true;
    }
    const items = Array.from(byId, ([id, label]) => ({ id, label })).sort((a, b) =>
      nameCollator.compare(a.label, b.label),
    );
    if (anyWithout) items.push({ id: NO_CLIENT, label: t('projects.noClient') });
    return items;
  }, [allRows, t]);

  const { pinnedRows, otherRows } = useMemo(() => {
    const memberSet = new Set(memberIds);
    const clientSet = new Set(clientIds);
    const q = search.trim().toLowerCase();
    const rows = allRows.filter((r) => {
      const completed = !!r.project.completed_at;
      if (status === 'active' && completed) return false;
      if (status === 'completed' && !completed) return false;
      if (r.hidden && !showHidden) return false;
      if (mineOnly && r.stats.mine === 0) return false;
      if (memberSet.size > 0 && !r.memberIds.some((id) => memberSet.has(id))) return false;
      if (clientSet.size > 0 && !clientSet.has(r.clientId ?? NO_CLIENT)) return false;
      if (q) {
        const hay = [r.project.name, r.project.description, r.clientName].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort(compareRows(sort));
    return { pinnedRows: rows.filter((r) => r.pinned), otherRows: rows.filter((r) => !r.pinned) };
  }, [allRows, status, showHidden, mineOnly, memberIds, clientIds, search, sort]);

  // Unpinned projects per client: clients by name, "No client" last. Rows keep the
  // chosen sort within each group.
  const clientGroups = useMemo(() => {
    if (!groupByClient) return null;
    const byKey = new Map<string, { key: string; name: string | null; rows: Row[] }>();
    for (const r of otherRows) {
      const key = r.clientId ?? NO_CLIENT;
      const g = byKey.get(key);
      if (g) g.rows.push(r);
      else byKey.set(key, { key, name: r.clientId ? r.clientName : null, rows: [r] });
    }
    return Array.from(byKey.values()).sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return nameCollator.compare(a.name, b.name);
    });
  }, [groupByClient, otherRows]);

  const peopleById = useMemo(
    () => new Map((tasks?.people ?? []).map((p) => [p.user_id, p])),
    [tasks?.people],
  );

  const filtersActive =
    status !== 'active' ||
    !!search.trim() ||
    memberIds.length > 0 ||
    clientIds.length > 0 ||
    mineOnly ||
    showHidden;
  function clearFilters() {
    setStatus('active');
    setSearch('');
    setMemberIds([]);
    setClientIds([]);
    setMineOnly(false);
    setShowHidden(false);
  }

  function togglePin(r: Row) {
    setPref.mutate(
      { projectId: r.project.id, pinned: !r.pinned },
      { onError: (err) => toast.error((err as Error).message) },
    );
  }

  function toggleHidden(r: Row) {
    const hide = !r.hidden;
    setPref.mutate(
      { projectId: r.project.id, hidden: hide },
      {
        onSuccess: () => {
          if (!hide) return;
          toast.success(t('projects.hidden_toast', { name: r.project.name }), {
            description: t('projects.hiddenHint'),
            action: {
              label: t('projects.undo'),
              onClick: () => setPref.mutate({ projectId: r.project.id, hidden: false }),
            },
          });
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  function toggleCompleted(r: Row) {
    const completed = !r.project.completed_at;
    setCompleted.mutate(
      { id: r.project.id, completed },
      {
        onSuccess: () =>
          toast.success(t(completed ? 'projects.completed_toast' : 'projects.reopened_toast')),
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  // Waiting on task data only matters when a filter depends on it.
  const waiting = isLoading || (tasksLoading && (mineOnly || memberIds.length > 0));
  const shown = pinnedRows.length + otherRows.length;

  // AppShell's <main> clips overflow, so the page scrolls itself. The scroller
  // is full-width so the wheel works anywhere and the scrollbar sits at the edge.
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold">{t('projects.title')}</h1>
            {projects.length > 0 && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {t('projects.showing', { shown, total: projects.length })}
              </div>
            )}
          </div>
          <NewProjectDialog />
        </div>
        {!isLoading && projects.length === 0 ? (
          <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
            <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('projects.noneYet')}</div>
            <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t('projects.createToStart')}</div>
            <NewProjectDialog />
          </div>
        ) : (
          <>
            <div className="mb-3">
              <ProjectFilters
                status={status}
                setStatus={setStatus}
                search={search}
                setSearch={setSearch}
                people={tasks?.people ?? []}
                memberIds={memberIds}
                setMemberIds={setMemberIds}
                clients={clientOptions}
                clientIds={clientIds}
                setClientIds={setClientIds}
                mineOnly={mineOnly}
                setMineOnly={setMineOnly}
                showHidden={showHidden}
                setShowHidden={setShowHidden}
                hiddenCount={hiddenCount}
                sort={sort}
                setSort={setSort}
                groupByClient={groupByClient}
                setGroupByClient={setGroupByClient}
              />
            </div>
            {waiting ? (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
            ) : shown === 0 ? (
              <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                <div className="mb-3">{t('projects.noMatch')}</div>
                {filtersActive && (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    {t('projects.clearFilters')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 overflow-hidden">
                <ListHeader />
                {(clientGroups ? pinnedRows : [...pinnedRows, ...otherRows]).map((r, i) => (
                  <ProjectRow
                    key={r.project.id}
                    row={r}
                    peopleById={peopleById}
                    statsReady={!!tasks}
                    // A heavier rule under the last pinned project separates the
                    // pinned block from the rest (client headings do that when grouped).
                    lastPinned={!clientGroups && i === pinnedRows.length - 1 && otherRows.length > 0}
                    onPin={() => togglePin(r)}
                    onHide={() => toggleHidden(r)}
                    onComplete={() => toggleCompleted(r)}
                  />
                ))}
                {clientGroups?.map((g, gi) => (
                  <div key={g.key}>
                    {/* Rows drop their bottom border at the end of a group, so later
                        headings draw the rule above themselves. */}
                    <div
                      className={cn(
                        'flex items-center gap-2 px-3 h-7 bg-neutral-50 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-600 dark:text-neutral-300',
                        gi > 0 && 'border-t',
                      )}
                    >
                      <Building2 size={12} className="text-neutral-400 dark:text-neutral-500" />
                      <span className="truncate">{g.name ?? t('projects.noClient')}</span>
                      <span className="text-neutral-400 dark:text-neutral-500 tabular-nums">{g.rows.length}</span>
                    </div>
                    {g.rows.map((r) => (
                      <ProjectRow
                        key={r.project.id}
                        row={r}
                        peopleById={peopleById}
                        statsReady={!!tasks}
                        hideClient
                        lastPinned={false}
                        onPin={() => togglePin(r)}
                        onHide={() => toggleHidden(r)}
                        onComplete={() => toggleCompleted(r)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <DeletedProjects />
      </div>
    </div>
  );
}

// Columns: pin · name/client · members · mine · progress · finish · menu. The
// secondary columns drop out at narrow widths, leaving pin, name and menu.
const COLS =
  'grid items-center gap-x-3 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] ' +
  'sm:grid-cols-[1.75rem_minmax(0,1fr)_6.5rem_7.5rem_1.75rem] ' +
  'lg:grid-cols-[1.75rem_minmax(0,1fr)_6.5rem_3.5rem_7.5rem_6.5rem_1.75rem]';

function ListHeader() {
  const t = useT();
  return (
    <div
      className={cn(
        COLS,
        'hidden sm:grid px-3 h-8 border-b border-neutral-200 dark:border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400',
      )}
    >
      <span />
      <span>{t('projects.col.name')}</span>
      <span>{t('projects.col.members')}</span>
      <span className="hidden lg:block text-right">{t('projects.col.mine')}</span>
      <span>{t('projects.col.progress')}</span>
      <span className="hidden lg:block">{t('projects.col.finish')}</span>
      <span />
    </div>
  );
}

function ProjectRow({
  row,
  peopleById,
  statsReady,
  hideClient = false,
  lastPinned,
  onPin,
  onHide,
  onComplete,
}: {
  row: Row;
  peopleById: Map<string, TasksPerson>;
  statsReady: boolean;
  /** Grouped under a client heading, so the subtitle needn't repeat it. */
  hideClient?: boolean;
  lastPinned: boolean;
  onPin: () => void;
  onHide: () => void;
  onComplete: () => void;
}) {
  const t = useT();
  const { project: p, stats, pinned, hidden, canEdit } = row;
  const completed = !!p.completed_at;
  const members = row.memberIds.map((id) => peopleById.get(id)).filter((m): m is TasksPerson => !!m);
  const shownMembers = members.slice(0, 4);
  const finish = parseDate(stats.finish);
  const subtitle = [hideClient ? null : row.clientName, p.description].filter(Boolean).join(' · ');
  const dash = <span className="text-neutral-400 dark:text-neutral-500">—</span>;

  return (
    <div
      className={cn(
        COLS,
        'group relative px-3 py-2.5 border-b last:border-b-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
        lastPinned
          ? 'border-b-2 border-neutral-300 dark:border-neutral-700'
          : 'border-neutral-200 dark:border-neutral-800',
      )}
    >
      <button
        type="button"
        onClick={onPin}
        className={cn(
          'relative z-10 h-7 w-7 -ml-1 flex items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700',
          pinned
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-neutral-400 dark:text-neutral-500 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100',
        )}
        title={pinned ? t('projects.unpin') : t('projects.pin')}
        aria-label={pinned ? t('projects.unpin') : t('projects.pin')}
        aria-pressed={pinned}
      >
        <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
      </button>

      <div className={cn('min-w-0', hidden && 'opacity-60')}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Stretched link: the whole row opens the project, while the pin
              and menu buttons sit above it. */}
          <Link
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            className="font-medium text-sm truncate after:absolute after:inset-0"
          >
            {p.name}
          </Link>
          {completed && <CompletedBadge />}
          {hidden && (
            <span title={t('projects.hiddenBadge')} className="shrink-0 text-neutral-400 dark:text-neutral-500">
              <EyeOff size={12} />
            </span>
          )}
        </div>
        {subtitle && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{subtitle}</div>
        )}
      </div>

      <div className="hidden sm:flex items-center -space-x-1.5">
        {shownMembers.map((m) => (
          <Avatar key={m.user_id} user={m} size="xs" className="ring-2 ring-white dark:ring-neutral-900" />
        ))}
        {members.length > shownMembers.length && (
          <span className="pl-2.5 text-[10px] text-neutral-500 dark:text-neutral-400 tabular-nums">
            +{members.length - shownMembers.length}
          </span>
        )}
      </div>

      <div className="hidden lg:block text-right text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
        {statsReady && (stats.mineOpen > 0 ? stats.mineOpen : dash)}
      </div>

      <div className="hidden sm:flex items-center gap-2">
        {statsReady &&
          (stats.tasks > 0 ? (
            <>
              <div className="flex-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                <div
                  className={cn('h-full rounded-full', stats.progress >= 100 ? 'bg-emerald-500' : 'bg-blue-500')}
                  style={{ width: `${stats.progress}%` }}
                />
              </div>
              <span className="w-8 text-right text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
                {stats.progress}%
              </span>
            </>
          ) : (
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{t('projects.noTasks')}</span>
          ))}
      </div>

      <div className="hidden lg:block text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
        {statsReady && (finish ? formatDate(finish) : dash)}
      </div>

      <RowMenu
        pinned={pinned}
        hidden={hidden}
        completed={completed}
        canEdit={canEdit}
        onPin={onPin}
        onHide={onHide}
        onComplete={onComplete}
      />
    </div>
  );
}

function RowMenu({
  pinned,
  hidden,
  completed,
  canEdit,
  onPin,
  onHide,
  onComplete,
}: {
  pinned: boolean;
  hidden: boolean;
  completed: boolean;
  canEdit: boolean;
  onPin: () => void;
  onHide: () => void;
  onComplete: () => void;
}) {
  const t = useT();
  const itemClass = cn(
    'flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none',
    'text-neutral-700 dark:text-neutral-200',
    'data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800',
  );
  const iconClass = 'text-neutral-500 dark:text-neutral-400';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative z-10 h-7 w-7 flex items-center justify-center rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 outline-none"
          aria-label={t('projects.actions')}
          title={t('projects.actions')}
        >
          <MoreHorizontal size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          <DropdownMenu.Item className={itemClass} onSelect={onPin}>
            {pinned ? <PinOff size={14} className={iconClass} /> : <Pin size={14} className={iconClass} />}
            {pinned ? t('projects.unpin') : t('projects.pin')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onHide}>
            {hidden ? <Eye size={14} className={iconClass} /> : <EyeOff size={14} className={iconClass} />}
            {hidden ? t('projects.unhide') : t('projects.hide')}
          </DropdownMenu.Item>
          {canEdit && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              <DropdownMenu.Item className={itemClass} onSelect={onComplete}>
                {completed ? (
                  <RotateCcw size={14} className={iconClass} />
                ) : (
                  <CheckCircle2 size={14} className={iconClass} />
                )}
                {completed ? t('projects.reopen') : t('projects.markCompleted')}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Projects the current user owns that were deleted; collapsed by default.
function DeletedProjects() {
  const { data = [] } = useDeletedProjects();
  const restore = useRestoreProject();
  const [open, setOpen] = useState(false);
  const t = useT();

  if (data.length === 0) return null;

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        <ChevronRight size={14} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {t('projects.deletedSection', { count: data.length })}
      </button>
      {open && (
        <div className="mt-2 border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
          {data.map((p) => (
            <div key={p.id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {p.deleted_by_name
                    ? t('projects.deletedBy', { date: formatDate(p.deleted_at), name: p.deleted_by_name })
                    : t('projects.deletedOn', { date: formatDate(p.deleted_at) })}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(p.id, {
                    onSuccess: () => toast.success(t('projects.restored_toast')),
                    onError: (err) => toast.error((err as Error).message),
                  })
                }
              >
                <RotateCcw size={14} /> {t('projects.restore')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useCreateProject();
  const t = useT();

  async function submit() {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: desc.trim() || undefined });
      setName('');
      setDesc('');
      setOpen(false);
      toast.success(t('projects.created_toast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus size={14} /> {t('projects.newProject')}</Button>
      </DialogTrigger>
      <DialogContent title={t('projects.newProject')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('projects.descriptionOptional')}</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={create.isPending || !name.trim()}>
              {create.isPending ? t('common.creating') : t('common.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
