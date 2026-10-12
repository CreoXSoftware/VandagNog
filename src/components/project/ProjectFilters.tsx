import { ArrowUpDown, Building2, Search, User } from 'lucide-react';
import { MultiSelect, type MultiSelectItem } from '@/components/ui/MultiSelect';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
  PROJECT_SORTS,
  PROJECT_STATUS_FILTERS,
  type ProjectSort,
  type ProjectStatusFilter,
} from '@/lib/projectsPrefs';
import type { TasksPerson } from '@/hooks/useTasksData';

interface Props {
  status: ProjectStatusFilter;
  setStatus: (s: ProjectStatusFilter) => void;
  search: string;
  setSearch: (s: string) => void;
  people: TasksPerson[];
  memberIds: string[];
  setMemberIds: (ids: string[]) => void;
  clients: MultiSelectItem[];
  clientIds: string[];
  setClientIds: (ids: string[]) => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  hiddenCount: number;
  sort: ProjectSort;
  setSort: (s: ProjectSort) => void;
  groupByClient: boolean;
  setGroupByClient: (v: boolean) => void;
}

export function ProjectFilters(props: Props) {
  const t = useT();
  const {
    status,
    setStatus,
    search,
    setSearch,
    people,
    memberIds,
    setMemberIds,
    clients,
    clientIds,
    setClientIds,
    mineOnly,
    setMineOnly,
    showHidden,
    setShowHidden,
    hiddenCount,
    sort,
    setSort,
    groupByClient,
    setGroupByClient,
  } = props;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
        {PROJECT_STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'px-3 h-7 text-xs rounded transition-colors',
              status === s
                ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100',
            )}
          >
            {t(`projects.status.${s}` as const)}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search
          size={13}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('projects.search')}
          className="h-7 w-52 pl-7 pr-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
        />
      </div>

      <MultiSelect
        icon={<User size={11} />}
        label={t('projects.members')}
        items={people.map((p) => ({ id: p.user_id, label: p.display_name }))}
        selected={memberIds}
        setSelected={setMemberIds}
        clearLabel={t('projects.clear')}
        align="start"
      />

      <MultiSelect
        icon={<Building2 size={11} />}
        label={t('projects.client')}
        items={clients}
        selected={clientIds}
        setSelected={setClientIds}
        clearLabel={t('projects.clear')}
        align="start"
      />

      <label
        className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none"
        title={t('projects.mineOnlyHint')}
      >
        <input
          type="checkbox"
          checked={mineOnly}
          onChange={(e) => setMineOnly(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('projects.mineOnly')}
      </label>

      <label
        className={cn(
          'flex items-center gap-1.5 text-xs cursor-pointer select-none',
          hiddenCount === 0 && !showHidden
            ? 'text-neutral-400 dark:text-neutral-500'
            : 'text-neutral-600 dark:text-neutral-300',
        )}
      >
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('projects.showHidden', { count: hiddenCount })}
      </label>

      <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={groupByClient}
          onChange={(e) => setGroupByClient(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('projects.groupByClient')}
      </label>

      <label className="flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
        <ArrowUpDown size={11} className="text-neutral-500 dark:text-neutral-400" />
        <span className="sr-only">{t('projects.sortLabel')}</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          className="h-7 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 text-[11px] border-0 outline-none hover:bg-neutral-200 dark:hover:bg-neutral-700"
          aria-label={t('projects.sortLabel')}
        >
          {PROJECT_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`projects.sort.${s}` as const)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
