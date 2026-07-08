import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useWorkloadData } from '@/hooks/useWorkloadData';
import { WorkloadFilters } from '@/components/workload/WorkloadFilters';
import { WorkloadView, type WorkloadRow } from '@/components/workload/WorkloadView';
import type { WorkItem } from '@/types/db';

export function WorkloadPage() {
  const t = useT();
  const { data, isLoading, error } = useWorkloadData();

  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  // People selectable in the filter — narrowed by the team filter so you pick team members.
  const availablePeople = useMemo(() => {
    if (!data) return [];
    if (teamIds.length === 0) return data.people;
    const allowed = new Set(teamIds.flatMap((id) => data.teamMembership[id] ?? []));
    return data.people.filter((p) => allowed.has(p.user_id));
  }, [data, teamIds]);

  const rows: WorkloadRow[] = useMemo(() => {
    if (!data) return [];
    const projectSet = new Set(projectIds);
    const personSet = new Set(personIds);
    const allowedPeople =
      teamIds.length === 0
        ? null
        : new Set(teamIds.flatMap((id) => data.teamMembership[id] ?? []));
    const q = search.trim().toLowerCase();

    let people = data.people;
    if (allowedPeople) people = people.filter((p) => allowedPeople.has(p.user_id));
    if (personSet.size > 0) people = people.filter((p) => personSet.has(p.user_id));
    if (q) people = people.filter((p) => p.display_name.toLowerCase().includes(q));

    const byPerson = new Map<string, WorkItem[]>();
    for (const tk of data.tasks) {
      if (projectSet.size > 0 && !projectSet.has(tk.project_id)) continue;
      if (!tk.assignee_id) continue;
      const arr = byPerson.get(tk.assignee_id);
      if (arr) arr.push(tk);
      else byPerson.set(tk.assignee_id, [tk]);
    }

    let result = people.map((person) => ({ person, tasks: byPerson.get(person.user_id) ?? [] }));
    if (hideEmpty) result = result.filter((r) => r.tasks.length > 0);
    return result;
  }, [data, projectIds, personIds, teamIds, search, hideEmpty]);

  const projectNameById = useMemo(
    () => new Map((data?.projects ?? []).map((p) => [p.id, p.name])),
    [data],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4">
        <h1 className="text-lg font-semibold">{t('workload.title')}</h1>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('workload.subtitle')}</div>
      </div>

      <div className="px-4 py-3">
        <WorkloadFilters
          projects={data?.projects ?? []}
          projectIds={projectIds}
          setProjectIds={setProjectIds}
          people={availablePeople}
          personIds={personIds}
          setPersonIds={setPersonIds}
          teams={data?.teams ?? []}
          teamIds={teamIds}
          setTeamIds={setTeamIds}
          search={search}
          setSearch={setSearch}
          hideEmpty={hideEmpty}
          setHideEmpty={setHideEmpty}
        />
        <StatusLegend />
      </div>

      <div className="flex-1 min-h-0 border-t border-neutral-200 dark:border-neutral-800">
        {isLoading ? (
          <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{t('workload.loadError')}</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400">{t('workload.noPeople')}</div>
        ) : (
          <WorkloadView
            rows={rows}
            calendar={data!.calendar}
            projectNameById={projectNameById}
          />
        )}
      </div>
    </div>
  );
}

const LEGEND: { key: 'not_started' | 'in_progress' | 'completed' | 'overdue'; dot: string }[] = [
  { key: 'not_started', dot: 'bg-neutral-400 dark:bg-neutral-600' },
  { key: 'in_progress', dot: 'bg-blue-500' },
  { key: 'completed', dot: 'bg-emerald-500' },
  { key: 'overdue', dot: 'bg-red-500' },
];

function StatusLegend() {
  const t = useT();
  return (
    <div className="flex items-center gap-3 mt-2 text-[10px] text-neutral-500 dark:text-neutral-400">
      {LEGEND.map((l) => (
        <span key={l.key} className="inline-flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${l.dot}`} />
          {t(`gantt.filter.statusValue.${l.key}` as const)}
        </span>
      ))}
    </div>
  );
}
