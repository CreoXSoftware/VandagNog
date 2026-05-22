import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Filter, X, User as UserIcon, CircleDot, CalendarRange, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { displayName } from '@/lib/userDisplay';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import type { ProjectMember, WorkItem } from '@/types/db';
import {
  EMPTY_FILTER,
  isFilterActive,
  type GanttFilterState,
  type StatusFilter,
} from './filterLogic';

interface Props {
  filter: GanttFilterState;
  setFilter: (f: GanttFilterState) => void;
  members: ProjectMember[];
  workItems: WorkItem[];
  currentUserId: string | null;
}

const STATUS_KEYS: StatusFilter[] = ['not_started', 'in_progress', 'completed', 'overdue'];

const STATUS_DOT: Record<StatusFilter, string> = {
  not_started: 'bg-neutral-400',
  in_progress: 'bg-blue-500',
  completed: 'bg-emerald-500',
  overdue: 'bg-red-500',
};

export function GanttFilters({ filter, setFilter, members, workItems, currentUserId }: Props) {
  const t = useT();

  const maxDepth = useMemo(() => {
    let m = 0;
    for (const w of workItems) if (!w.deleted_at && w.level > m) m = w.level;
    return m;
  }, [workItems]);

  const active = isFilterActive(filter);

  function toggleAssignee(key: string) {
    const has = filter.assignees.includes(key);
    setFilter({
      ...filter,
      assignees: has ? filter.assignees.filter((a) => a !== key) : [...filter.assignees, key],
    });
  }
  function toggleStatus(s: StatusFilter) {
    const has = filter.statuses.includes(s);
    setFilter({
      ...filter,
      statuses: has ? filter.statuses.filter((x) => x !== s) : [...filter.statuses, s],
    });
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Filter size={12} className="text-neutral-500 dark:text-neutral-400" />

      {/* Assignee */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 h-6 px-2 rounded text-[11px]',
              filter.assignees.length > 0
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
            )}
          >
            <UserIcon size={11} />
            {t('gantt.filter.assignee')}
            {filter.assignees.length > 0 && (
              <span className="tabular-nums">· {filter.assignees.length}</span>
            )}
          </button>
        </Popover.Trigger>
        <PopoverContent>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
            {t('gantt.filter.assignee')}
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            <CheckRow
              checked={filter.assignees.includes('unassigned')}
              onChange={() => toggleAssignee('unassigned')}
              label={t('workItem.unassigned')}
            />
            {members.map((m) => (
              <CheckRow
                key={m.user_id}
                checked={filter.assignees.includes(m.user_id)}
                onChange={() => toggleAssignee(m.user_id)}
                label={displayName(m)}
                leading={<Avatar user={m} size="xs" />}
              />
            ))}
          </div>
          {filter.assignees.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setFilter({ ...filter, assignees: [] })}
            >
              {t('gantt.filter.clear')}
            </Button>
          )}
        </PopoverContent>
      </Popover.Root>

      {/* Status */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 h-6 px-2 rounded text-[11px]',
              filter.statuses.length > 0
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
            )}
          >
            <CircleDot size={11} />
            {t('gantt.filter.status')}
            {filter.statuses.length > 0 && (
              <span className="tabular-nums">· {filter.statuses.length}</span>
            )}
          </button>
        </Popover.Trigger>
        <PopoverContent>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
            {t('gantt.filter.status')}
          </div>
          <div className="space-y-0.5">
            {STATUS_KEYS.map((s) => (
              <CheckRow
                key={s}
                checked={filter.statuses.includes(s)}
                onChange={() => toggleStatus(s)}
                label={t(`gantt.filter.statusValue.${s}` as never)}
                leading={<span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />}
              />
            ))}
          </div>
          {filter.statuses.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setFilter({ ...filter, statuses: [] })}
            >
              {t('gantt.filter.clear')}
            </Button>
          )}
        </PopoverContent>
      </Popover.Root>

      {/* Date range */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            className={cn(
              'flex items-center gap-1 h-6 px-2 rounded text-[11px]',
              (filter.dateFrom || filter.dateTo)
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
            )}
          >
            <CalendarRange size={11} />
            {t('gantt.filter.dateRange')}
          </button>
        </Popover.Trigger>
        <PopoverContent>
          <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
            {t('gantt.filter.dateRange')}
          </div>
          <div className="space-y-2">
            <label className="block">
              <span className="text-[11px] text-neutral-600 dark:text-neutral-300">{t('workItem.start')}</span>
              <input
                type="date"
                value={filter.dateFrom ?? ''}
                onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value || null })}
                className="mt-0.5 w-full h-7 px-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-neutral-600 dark:text-neutral-300">{t('workItem.end')}</span>
              <input
                type="date"
                value={filter.dateTo ?? ''}
                onChange={(e) => setFilter({ ...filter, dateTo: e.target.value || null })}
                className="mt-0.5 w-full h-7 px-2 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs"
              />
            </label>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
              {t('gantt.filter.dateRangeHint')}
            </p>
          </div>
          {(filter.dateFrom || filter.dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setFilter({ ...filter, dateFrom: null, dateTo: null })}
            >
              {t('gantt.filter.clear')}
            </Button>
          )}
        </PopoverContent>
      </Popover.Root>

      {/* Depth limit */}
      {maxDepth > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              className={cn(
                'flex items-center gap-1 h-6 px-2 rounded text-[11px]',
                filter.maxDepth !== null
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
              )}
            >
              <Layers size={11} />
              {t('gantt.filter.depth')}
              {filter.maxDepth !== null && (
                <span className="tabular-nums">· L{filter.maxDepth + 1}</span>
              )}
            </button>
          </Popover.Trigger>
          <PopoverContent>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
              {t('gantt.filter.depth')}
            </div>
            <div className="space-y-1">
              {Array.from({ length: maxDepth + 1 }, (_, i) => i).map((d) => (
                <button
                  key={d}
                  onClick={() => setFilter({ ...filter, maxDepth: d })}
                  className={cn(
                    'w-full text-left px-2 py-1 rounded text-xs',
                    filter.maxDepth === d
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  )}
                >
                  {t('gantt.filter.upTo', { level: `L${d + 1}` })}
                </button>
              ))}
            </div>
            {filter.maxDepth !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setFilter({ ...filter, maxDepth: null })}
              >
                {t('gantt.filter.clear')}
              </Button>
            )}
          </PopoverContent>
        </Popover.Root>
      )}

      {/* "Me" shortcuts */}
      {currentUserId && (
        <div className="flex items-center gap-1 ml-1 pl-1 border-l border-neutral-200 dark:border-neutral-700">
          <button
            onClick={() =>
              setFilter({ ...filter, me: filter.me === 'assigned' ? null : 'assigned' })
            }
            className={cn(
              'h-6 px-2 rounded text-[11px]',
              filter.me === 'assigned'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
            )}
          >
            {t('gantt.filter.assignedToMe')}
          </button>
          <button
            onClick={() =>
              setFilter({ ...filter, me: filter.me === 'created' ? null : 'created' })
            }
            className={cn(
              'h-6 px-2 rounded text-[11px]',
              filter.me === 'created'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
            )}
          >
            {t('gantt.filter.createdByMe')}
          </button>
        </div>
      )}

      {active && (
        <button
          onClick={() => setFilter(EMPTY_FILTER)}
          className="ml-1 h-6 px-2 rounded text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-1"
          title={t('gantt.filter.clearAll')}
        >
          <X size={11} /> {t('gantt.filter.clearAll')}
        </button>
      )}
    </div>
  );
}

function PopoverContent({ children }: { children: React.ReactNode }) {
  return (
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={4}
        className="z-50 w-64 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-2"
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  leading,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  leading?: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer text-xs">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5" />
      {leading}
      <span className="flex-1 truncate">{label}</span>
    </label>
  );
}
