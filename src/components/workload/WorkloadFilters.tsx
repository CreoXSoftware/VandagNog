import * as Popover from '@radix-ui/react-popover';
import { FolderKanban, Search, User, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type {
  WorkloadPerson,
  WorkloadProjectInfo,
  WorkloadTeamInfo,
} from '@/hooks/useWorkloadData';

interface Props {
  projects: WorkloadProjectInfo[];
  projectIds: string[];
  setProjectIds: (ids: string[]) => void;
  people: WorkloadPerson[];
  personIds: string[];
  setPersonIds: (ids: string[]) => void;
  teams: WorkloadTeamInfo[];
  teamIds: string[];
  setTeamIds: (ids: string[]) => void;
  search: string;
  setSearch: (s: string) => void;
  hideEmpty: boolean;
  setHideEmpty: (v: boolean) => void;
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
    teams,
    teamIds,
    setTeamIds,
    search,
    setSearch,
    hideEmpty,
    setHideEmpty,
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

      {/* Team filter */}
      {teams.length > 0 && (
        <MultiSelect
          icon={<Users size={11} />}
          label={t('workload.team')}
          items={teams.map((tm) => ({ id: tm.id, label: tm.name }))}
          selected={teamIds}
          setSelected={setTeamIds}
          clearLabel={t('workload.clear')}
        />
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
    </div>
  );
}

function MultiSelect({
  icon,
  label,
  items,
  selected,
  setSelected,
  clearLabel,
}: {
  icon: React.ReactNode;
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  clearLabel: string;
}) {
  function toggle(id: string) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 h-7 px-2 rounded text-[11px]',
            selected.length > 0
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
          )}
        >
          {icon}
          {label}
          {selected.length > 0 && <span className="tabular-nums">· {selected.length}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50 w-56 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-2"
        >
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {items.length === 0 && (
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 px-1.5 py-1">—</div>
            )}
            {items.map((it) => (
              <label
                key={it.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(it.id)}
                  onChange={() => toggle(it.id)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1 truncate">{it.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="mt-2 w-full h-7 rounded text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {clearLabel}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
