import { useMemo, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Download, Filter as FilterIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useReportEntries } from '@/hooks/useTimeEntries';
import { useTrackerCatalog, workItemPath } from '@/hooks/useTrackerCatalog';
import { useTrackerPeople } from '@/hooks/useTrackerPeople';
import { useMyTeams, useTeamMembers } from '@/hooks/useTeams';
import { durationMs, formatHM, formatHoursDecimal, isoDate } from '@/lib/timeFormat';
import { exportCSV, exportExcel, exportPDF, type ReportRow, type ReportSummary } from '@/lib/exporters/trackerExports';
import type { TimeEntry } from '@/types/db';

type TaskMode = 'all' | 'noTask' | 'workItem' | 'custom';

interface Filters {
  since: string; // YYYY-MM-DD inclusive
  until: string; // YYYY-MM-DD exclusive (one day after the last day included)
  team_id: string;
  user_id: string;
  client_id: string;
  project_id: string;
  work_item_id: string;
  task_mode: TaskMode;
  custom_query: string;
}

function defaultFilters(): Filters {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    since: isoDate(since),
    until: isoDate(until),
    team_id: '',
    user_id: '',
    client_id: '',
    project_id: '',
    work_item_id: '',
    task_mode: 'all',
    custom_query: '',
  };
}

export function TrackerReportsPage() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onReports = path.startsWith('/tracker/reports');

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // Server-side date range. RLS limits to projects I'm a member of.
  const sinceIso = useMemo(() => new Date(filters.since + 'T00:00:00').toISOString(), [filters.since]);
  const untilIso = useMemo(() => new Date(filters.until + 'T00:00:00').toISOString(), [filters.until]);
  const { data: entries = [], isLoading } = useReportEntries({ since: sinceIso, until: untilIso });

  const { data: catalog } = useTrackerCatalog();
  const { data: people = [] } = useTrackerPeople();
  const { data: teams = [] } = useMyTeams();
  const { data: teamMembers = [] } = useTeamMembers(filters.team_id || undefined);

  const teamUserIds = useMemo<Set<string> | null>(() => {
    if (!filters.team_id) return null;
    return new Set(teamMembers.map((m) => m.user_id));
  }, [filters.team_id, teamMembers]);

  // Filter the server result client-side
  const filtered = useMemo(() => filterEntries(entries, filters, teamUserIds, catalog), [entries, filters, teamUserIds, catalog]);

  // Materialise into ReportRow[] for export + table
  const rows = useMemo<ReportRow[]>(() => {
    if (!catalog) return [];
    const personById = new Map(people.map((p) => [p.user_id, p.display_name]));
    return filtered.map((e) => entryToRow(e, catalog, personById));
  }, [filtered, catalog, people]);

  const totalMs = rows.reduce((s, r) => s + r.durationMs, 0);
  const summary = useMemo<ReportSummary>(() => ({
    totalMs,
    range: { since: filters.since, until: filters.until },
    filters: filterChips(filters, catalog, people, teams),
    rows,
  }), [totalMs, filters, catalog, people, teams, rows]);

  // Workitem options scoped to selected project
  const wiOptions = useMemo(() => {
    if (!catalog || !filters.project_id) return [];
    return catalog.workItems
      .filter((w) => w.project_id === filters.project_id)
      .map((w) => ({ id: w.id, path: workItemPath(w.id, catalog.workItems).join(' › ') }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [catalog, filters.project_id]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{t('tracker.reportsTitle')}</h1>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.reportsSubtitle')}</div>
          </div>
          <PageTabs onReports={onReports} />
        </div>

        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-4">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            <FilterIcon size={12} /> {t('tracker.filters')}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-3">
            <Field label={t('tracker.from')}>
              <Input type="date" value={filters.since} onChange={(e) => patch({ since: e.target.value })} />
            </Field>
            <Field label={t('tracker.to')}>
              <Input type="date" value={filters.until} onChange={(e) => patch({ until: e.target.value })} />
            </Field>
            <Field label={t('tracker.team')}>
              <Select value={filters.team_id} onChange={(e) => patch({ team_id: e.target.value, user_id: '' })}>
                <option value="">{t('tracker.anyTeam')}</option>
                {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </Select>
            </Field>
            <Field label={t('tracker.member')}>
              <Select value={filters.user_id} onChange={(e) => patch({ user_id: e.target.value })}>
                <option value="">{t('tracker.anyMember')}</option>
                {people
                  .filter((p) => !teamUserIds || teamUserIds.has(p.user_id))
                  .map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
              </Select>
            </Field>
            <Field label={t('tracker.client')}>
              <Select value={filters.client_id} onChange={(e) => patch({ client_id: e.target.value, project_id: '', work_item_id: '' })}>
                <option value="">{t('tracker.anyClient')}</option>
                {catalog?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={t('tracker.project')}>
              <Select value={filters.project_id} onChange={(e) => patch({ project_id: e.target.value, work_item_id: '' })}>
                <option value="">{t('tracker.anyProject')}</option>
                {catalog?.projects
                  .filter((p) => !filters.client_id || p.client_id === filters.client_id)
                  .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('tracker.task')}>
              <Select
                value={filters.work_item_id}
                onChange={(e) => patch({ work_item_id: e.target.value, task_mode: e.target.value ? 'workItem' : filters.task_mode })}
                disabled={!filters.project_id}
              >
                <option value="">{t('tracker.anyTask')}</option>
                {wiOptions.map((w) => <option key={w.id} value={w.id}>{w.path}</option>)}
              </Select>
            </Field>
            <Field label={t('tracker.taskMode')}>
              <Select value={filters.task_mode} onChange={(e) => patch({ task_mode: e.target.value as TaskMode, work_item_id: '' })}>
                <option value="all">{t('tracker.modeAll')}</option>
                <option value="noTask">{t('tracker.modeNoTask')}</option>
                <option value="workItem">{t('tracker.modeWorkItem')}</option>
                <option value="custom">{t('tracker.modeCustom')}</option>
              </Select>
            </Field>
          </div>

          {filters.task_mode === 'custom' && (
            <Field label={t('tracker.customQuery')}>
              <Input
                placeholder={t('tracker.customQueryPlaceholder')}
                value={filters.custom_query}
                onChange={(e) => patch({ custom_query: e.target.value })}
              />
            </Field>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <Button variant="ghost" onClick={() => setFilters(defaultFilters())}>{t('tracker.resetFilters')}</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportCSV(summary)} disabled={!rows.length}>
                <Download size={14} /> CSV
              </Button>
              <Button variant="outline" onClick={() => exportExcel(summary)} disabled={!rows.length}>
                <Download size={14} /> Excel
              </Button>
              <Button variant="outline" onClick={() => exportPDF(summary)} disabled={!rows.length}>
                <Download size={14} /> PDF
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
        ) : !rows.length ? (
          <div className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-10">
            {t('tracker.noResults')}
          </div>
        ) : (
          <SummaryView rows={rows} totalMs={totalMs} />
        )}
      </div>
    </div>
  );
}

// ----- Helpers ---------------------------------------------------------------

function entryToRow(
  e: TimeEntry,
  catalog: NonNullable<ReturnType<typeof useTrackerCatalog>['data']>,
  personById: Map<string, string>,
): ReportRow {
  const project = catalog.projects.find((p) => p.id === e.project_id);
  const taskParts: string[] = [];
  if (e.work_item_id) taskParts.push(...workItemPath(e.work_item_id, catalog.workItems));
  else if (e.custom_task_text) taskParts.push(`“${e.custom_task_text}”`);
  else taskParts.push('No task');
  const start = new Date(e.start_at);
  const end = e.end_at ? new Date(e.end_at) : start;
  return {
    client: project?.client_name ?? '',
    project: project?.name ?? '',
    task: taskParts.join(' › '),
    user: personById.get(e.user_id) ?? '',
    date: isoDate(start),
    start: start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    end: end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    durationMs: durationMs(e.start_at, e.end_at),
    notes: e.notes ?? '',
  };
}

function filterEntries(
  entries: TimeEntry[],
  f: Filters,
  teamUserIds: Set<string> | null,
  catalog: ReturnType<typeof useTrackerCatalog>['data'] | undefined,
): TimeEntry[] {
  if (!catalog) return [];
  const projectClient = new Map(catalog.projects.map((p) => [p.id, p.client_id]));
  const q = f.custom_query.trim().toLowerCase();
  return entries.filter((e) => {
    if (teamUserIds && !teamUserIds.has(e.user_id)) return false;
    if (f.user_id && e.user_id !== f.user_id) return false;
    if (f.client_id) {
      const cid = projectClient.get(e.project_id);
      if (cid !== f.client_id) return false;
    }
    if (f.project_id && e.project_id !== f.project_id) return false;
    if (f.work_item_id && e.work_item_id !== f.work_item_id) return false;
    switch (f.task_mode) {
      case 'noTask': if (e.work_item_id || e.custom_task_text) return false; break;
      case 'workItem': if (!e.work_item_id) return false; break;
      case 'custom':
        if (!e.custom_task_text) return false;
        if (q && !e.custom_task_text.toLowerCase().includes(q)) return false;
        break;
    }
    return true;
  });
}

function filterChips(
  f: Filters,
  catalog: ReturnType<typeof useTrackerCatalog>['data'] | undefined,
  people: ReturnType<typeof useTrackerPeople>['data'] | undefined,
  teams: ReturnType<typeof useMyTeams>['data'] | undefined,
): string[] {
  const out: string[] = [`${f.since} → ${f.until}`];
  if (f.team_id) out.push(`Team: ${teams?.find((t) => t.id === f.team_id)?.name ?? f.team_id}`);
  if (f.user_id) out.push(`Member: ${people?.find((p) => p.user_id === f.user_id)?.display_name ?? f.user_id}`);
  if (f.client_id) out.push(`Client: ${catalog?.clients.find((c) => c.id === f.client_id)?.name ?? f.client_id}`);
  if (f.project_id) out.push(`Project: ${catalog?.projects.find((p) => p.id === f.project_id)?.name ?? f.project_id}`);
  if (f.work_item_id) out.push(`Task: ${f.work_item_id}`);
  if (f.task_mode !== 'all') out.push(`Task type: ${f.task_mode}`);
  if (f.custom_query) out.push(`Custom: ${f.custom_query}`);
  return out;
}

// ----- UI ------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</label>
      <div className="[&>select]:w-full [&>input]:w-full">{children}</div>
    </div>
  );
}

function PageTabs({ onReports }: { onReports: boolean }) {
  const t = useT();
  return (
    <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
      <Link
        to="/tracker"
        className={cn(
          'px-3 h-7 text-xs rounded inline-flex items-center',
          !onReports
            ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
        )}
      >
        {t('tracker.tabTrack')}
      </Link>
      <Link
        to="/tracker/reports"
        className={cn(
          'px-3 h-7 text-xs rounded inline-flex items-center',
          onReports
            ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
        )}
      >
        {t('tracker.tabReports')}
      </Link>
    </div>
  );
}

function SummaryView({ rows, totalMs }: { rows: ReportRow[]; totalMs: number }) {
  const t = useT();
  const tree = useMemo(() => buildSummary(rows), [rows]);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex items-baseline gap-6">
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.totalHours')}</div>
          <div className="font-mono text-2xl tabular-nums">{formatHoursDecimal(totalMs, 2)} h</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.totalDuration')}</div>
          <div className="font-mono text-2xl tabular-nums">{formatHM(totalMs)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.entries')}</div>
          <div className="font-mono text-2xl tabular-nums">{rows.length}</div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {tree.map((node) => <SummaryNode key={node.key} node={node} depth={0} />)}
      </div>
    </div>
  );
}

interface SummaryNode {
  key: string;
  label: string;
  totalMs: number;
  count: number;
  byUser: { user: string; ms: number }[];
  children?: SummaryNode[];
}

function buildSummary(rows: ReportRow[]): SummaryNode[] {
  const clients = new Map<string, SummaryNode>();
  for (const r of rows) {
    const clientLabel = r.client || '—';
    let c = clients.get(clientLabel);
    if (!c) {
      c = { key: clientLabel, label: clientLabel, totalMs: 0, count: 0, byUser: [], children: [] };
      clients.set(clientLabel, c);
    }
    c.totalMs += r.durationMs;
    c.count += 1;
    addByUser(c.byUser, r.user, r.durationMs);

    const projKey = `${clientLabel}|${r.project}`;
    let p = c.children!.find((x) => x.key === projKey);
    if (!p) {
      p = { key: projKey, label: r.project, totalMs: 0, count: 0, byUser: [], children: [] };
      c.children!.push(p);
    }
    p.totalMs += r.durationMs;
    p.count += 1;
    addByUser(p.byUser, r.user, r.durationMs);

    const taskKey = `${projKey}|${r.task}`;
    let tk = p.children!.find((x) => x.key === taskKey);
    if (!tk) {
      tk = { key: taskKey, label: r.task, totalMs: 0, count: 0, byUser: [] };
      p.children!.push(tk);
    }
    tk.totalMs += r.durationMs;
    tk.count += 1;
    addByUser(tk.byUser, r.user, r.durationMs);
  }
  const flat = Array.from(clients.values());
  for (const c of flat) {
    c.children!.sort((a, b) => b.totalMs - a.totalMs);
    for (const p of c.children!) p.children!.sort((a, b) => b.totalMs - a.totalMs);
  }
  return flat.sort((a, b) => b.totalMs - a.totalMs);
}

function addByUser(arr: { user: string; ms: number }[], user: string, ms: number) {
  const u = arr.find((x) => x.user === user);
  if (u) u.ms += ms;
  else arr.push({ user: user || '—', ms });
}

function SummaryNode({ node, depth }: { node: SummaryNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = !!node.children?.length;
  return (
    <div className={cn(depth > 0 && 'border-t border-neutral-200 dark:border-neutral-800')}>
      <button
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between text-left',
          'px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900',
          depth === 0 && 'bg-neutral-50/60 dark:bg-neutral-900/60 font-medium',
        )}
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {hasChildren ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
          <span className="truncate">{node.label}</span>
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">({node.count})</span>
        </div>
        <div className="font-mono tabular-nums text-sm text-neutral-700 dark:text-neutral-200">
          {formatHM(node.totalMs)}
        </div>
      </button>
      {open && hasChildren && (
        <div>
          {node.children!.map((c) => <SummaryNode key={c.key} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}
