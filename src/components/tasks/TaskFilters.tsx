import { CircleDot, FolderKanban, Search, User } from 'lucide-react';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { TIME_FILTERS, type TimeFilter } from '@/lib/tasksFilter';
import type { StatusFilter } from '@/components/gantt/filterLogic';
import type { TasksPerson, TasksProjectInfo } from '@/hooks/useTasksData';

/** Sentinel id for "no assignee" in the assignee filter. */
export const UNASSIGNED = 'unassigned';

const STATUSES: StatusFilter[] = ['not_started', 'in_progress', 'completed', 'overdue'];

interface Props {
  when: TimeFilter;
  setWhen: (w: TimeFilter) => void;
  projects: TasksProjectInfo[];
  projectIds: string[];
  setProjectIds: (ids: string[]) => void;
  people: TasksPerson[];
  assigneeIds: string[];
  setAssigneeIds: (ids: string[]) => void;
  statuses: string[];
  setStatuses: (s: string[]) => void;
  search: string;
  setSearch: (s: string) => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  showDone: boolean;
  setShowDone: (v: boolean) => void;
  hideEmpty: boolean;
  setHideEmpty: (v: boolean) => void;
}

export function TaskFilters(props: Props) {
  const t = useT();
  const {
    when,
    setWhen,
    projects,
    projectIds,
    setProjectIds,
    people,
    assigneeIds,
    setAssigneeIds,
    statuses,
    setStatuses,
    search,
    setSearch,
    mineOnly,
    setMineOnly,
    showDone,
    setShowDone,
    hideEmpty,
    setHideEmpty,
  } = props;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Time filter — the primary control, so it gets the segmented treatment. */}
      <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
        {TIME_FILTERS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWhen(w)}
            className={cn(
              'px-3 h-7 text-xs rounded transition-colors',
              when === w
                ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100',
            )}
          >
            {t(`tasks.when.${w}` as const)}
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
          placeholder={t('tasks.search')}
          className="h-7 w-44 pl-7 pr-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
        />
      </div>

      <MultiSelect
        icon={<FolderKanban size={11} />}
        label={t('tasks.project')}
        items={projects.map((p) => ({ id: p.id, label: p.name }))}
        selected={projectIds}
        setSelected={setProjectIds}
        clearLabel={t('tasks.clear')}
      />

      <MultiSelect
        icon={<User size={11} />}
        label={t('tasks.assignee')}
        // 70% of live work items have no assignee, so "Unassigned" is a
        // first-class choice rather than an absence.
        items={[
          { id: UNASSIGNED, label: t('tasks.unassigned') },
          ...people.map((p) => ({ id: p.user_id, label: p.display_name })),
        ]}
        selected={assigneeIds}
        setSelected={setAssigneeIds}
        clearLabel={t('tasks.clear')}
      />

      <MultiSelect
        icon={<CircleDot size={11} />}
        label={t('tasks.status')}
        items={STATUSES.map((s) => ({
          id: s,
          label: t(`gantt.filter.statusValue.${s}` as const),
        }))}
        selected={statuses}
        setSelected={setStatuses}
        clearLabel={t('tasks.clear')}
      />

      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={mineOnly}
          onChange={(e) => setMineOnly(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('tasks.mineOnly')}
      </label>

      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={showDone}
          onChange={(e) => setShowDone(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('tasks.showDone')}
      </label>

      <label
        className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer select-none"
        title={t('tasks.hideEmptyHint')}
      >
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => setHideEmpty(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t('tasks.hideEmpty')}
      </label>
    </div>
  );
}
