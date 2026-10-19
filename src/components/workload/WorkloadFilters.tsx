import { FolderKanban, Search, User } from 'lucide-react';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useT } from '@/lib/i18n';
import type { WorkloadPerson, WorkloadProjectInfo } from '@/hooks/useWorkloadData';

interface Props {
  projects: WorkloadProjectInfo[];
  projectIds: string[];
  setProjectIds: (ids: string[]) => void;
  people: WorkloadPerson[];
  personIds: string[];
  setPersonIds: (ids: string[]) => void;
  /** Any guest in the data — the toggle only shows when there is something to toggle. */
  hasGuests: boolean;
  showGuests: boolean;
  setShowGuests: (v: boolean) => void;
  search: string;
  setSearch: (s: string) => void;
  hideEmpty: boolean;
  setHideEmpty: (v: boolean) => void;
  overdueOnly: boolean;
  setOverdueOnly: (v: boolean) => void;
  /** Only my own row; overrides the people and guest filters. */
  onlyMine: boolean;
  setOnlyMine: (v: boolean) => void;
}

export function WorkloadFilters(props: Props) {
  const t = useT();
  const {
    projects,
    projectIds,
    setProjectIds,
    people,
    personIds,
    setPersonIds,
    hasGuests,
    showGuests,
    setShowGuests,
    search,
    setSearch,
    hideEmpty,
    setHideEmpty,
    overdueOnly,
    setOverdueOnly,
    onlyMine,
    setOnlyMine,
  } = props;

  return (
    <div className="flex items-center gap-2 flex-wrap">

      {/* Person search */}
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('workload.searchPerson')}
          className="h-7 w-40 pl-7 pr-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
        />
      </div>

      {/* People filter */}
      <MultiSelect
        icon={<User size={11} />}
        label={t('workload.people')}
        items={people.map((p) => ({ id: p.user_id, label: p.display_name }))}
        selected={personIds}
        setSelected={setPersonIds}
        clearLabel={t('workload.clear')}
      />

      {/* Project filter */}
      <MultiSelect
        icon={<FolderKanban size={11} />}
        label={t('workload.project')}
        items={projects.map((p) => ({ id: p.id, label: p.name }))}
        selected={projectIds}
        setSelected={setProjectIds}
        clearLabel={t('workload.clear')}
      />

      {/* Only my own row */}
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={onlyMine}
          onChange={(e) => setOnlyMine(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('workload.onlyMine')}
      </label>

      {/* Guests of the organization */}
      {hasGuests && (
        <label
          className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none"
          title={t('workload.showGuestsHint')}
        >
          <input
            type="checkbox"
            checked={showGuests}
            onChange={(e) => setShowGuests(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t('workload.showGuests')}
        </label>
      )}

      {/* Hide empty */}
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => setHideEmpty(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('workload.hideEmpty')}
      </label>

      {/* Only people with overdue work */}
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={overdueOnly}
          onChange={(e) => setOverdueOnly(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('workload.overdueOnly')}
      </label>
    </div>
  );
}
