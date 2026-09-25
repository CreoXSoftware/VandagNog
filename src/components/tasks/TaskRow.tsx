import { Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useI18n, useT } from '@/lib/i18n';
import { parseDate } from '@/components/gantt/ganttUtils';
import type { WorkItem } from '@/types/db';
import type { TasksPerson } from '@/hooks/useTasksData';

interface Props {
  item: WorkItem;
  /** Ancestor names, outermost first — shown as dimmed breadcrumb before the name. */
  breadcrumb: string[];
  assignee: TasksPerson | undefined;
  isMine: boolean;
  canEdit: boolean;
  today: string;
  selected: boolean;
  onToggle: (item: WorkItem, done: boolean) => void;
  onOpen: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
}

export function TaskRow({
  item,
  breadcrumb,
  assignee,
  isMine,
  canEdit,
  today,
  selected,
  onToggle,
  onOpen,
  onDelete,
}: Props) {
  const t = useT();
  const { lang } = useI18n();
  const done = item.progress >= 100;
  const overdue = !done && !!item.end_date && item.end_date < today;

  return (
    <div
      className={cn(
        'group flex items-center gap-2 pl-3 pr-2 h-9 border-b border-neutral-100 dark:border-neutral-800/60',
        'hover:bg-neutral-50 dark:hover:bg-neutral-900/60',
        selected && 'bg-blue-50/70 dark:bg-blue-950/30',
      )}
    >
      {/* Disabled inputs swallow pointer events, so the title lives on the wrapper. */}
      <span className="shrink-0 flex" title={canEdit ? undefined : t('tasks.readOnly')}>
        <input
          type="checkbox"
          checked={done}
          disabled={!canEdit}
          onChange={(e) => onToggle(item, e.target.checked)}
          aria-label={item.name}
          className="h-4 w-4 accent-emerald-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        />
      </span>

      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
      >
        {breadcrumb.length > 0 && (
          <span className="shrink-0 max-w-[40%] truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            {breadcrumb.join(' › ')} ›
          </span>
        )}
        <span
          className={cn(
            'truncate text-sm',
            done && 'line-through text-neutral-400 dark:text-neutral-500',
          )}
        >
          {item.name}
        </span>
        {isMine && !done && (
          <span
            title={t('tasks.assignedToMe')}
            className="shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500"
          />
        )}
      </button>

      {item.progress > 0 && !done && (
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {item.progress}%
        </span>
      )}

      <span
        className={cn(
          'shrink-0 text-[11px] tabular-nums',
          overdue
            ? 'text-red-600 dark:text-red-400 font-medium'
            : 'text-neutral-400 dark:text-neutral-500',
        )}
      >
        {formatRange(item.start_date, item.end_date, lang === 'af' ? 'af-ZA' : 'en-US')}
      </span>

      {assignee ? (
        <Avatar user={assignee} size="xs" />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700" />
      )}

      <button
        type="button"
        onClick={() => onDelete(item)}
        disabled={!canEdit}
        title={t('common.delete')}
        aria-label={t('common.delete')}
        className={cn(
          'shrink-0 p-1 rounded text-neutral-400 dark:text-neutral-500',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          'hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-red-600 dark:hover:text-red-400',
          'disabled:hidden',
        )}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// Compact, locale-aware span. Goes through parseDate (local midnight) rather
// than new Date(iso) so the day never shifts in a negative-offset timezone.
function formatRange(start: string | null, end: string | null, locale: string): string {
  if (!start && !end) return '—';
  const s = start ? parseDate(start) : null;
  const e = end ? parseDate(end) : null;
  const day: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (s && e) {
    if (start === end) return e.toLocaleDateString(locale, day);
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `${s.getDate()}–${e.toLocaleDateString(locale, day)}`;
    }
    return `${s.toLocaleDateString(locale, day)} – ${e.toLocaleDateString(locale, day)}`;
  }
  const one = s ?? e;
  return one ? one.toLocaleDateString(locale, day) : '—';
}
