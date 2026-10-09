import { useState } from 'react';
import {
  AlignLeft,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ListTree,
  PanelRightOpen,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { modLabel, type QuickKey } from '@/lib/platform';
import { formatRange } from '@/lib/taskFormat';
import type { OutlineRow } from '@/lib/taskOutline';
import type { TasksPerson } from '@/hooks/useTasksData';

export type DropPos = 'before' | 'after' | 'on';

const INDENT_PX = 20;
const BASE_PAD_PX = 4;

function indentPx(depth: number): number {
  return BASE_PAD_PX + depth * INDENT_PX;
}

interface ItemRowProps {
  row: Extract<OutlineRow, { kind: 'item' }>;
  canEdit: boolean;
  today: string;
  locale: string;
  selected: boolean;
  isMine: boolean;
  assignee: TasksPerson | undefined;
  durationLabel: string;
  drop: DropPos | null;
  dragging: boolean;
  registerInput: (el: HTMLInputElement | null) => void;
  registerRow: (el: HTMLDivElement | null) => void;
  onCommitName: (name: string) => void;
  /**
   * Keys the outline handles (Enter, Tab, arrows, quick-edit). The name itself
   * is committed on blur only — every one of those actions moves focus anyway,
   * and committing in both places would send the rename twice.
   */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggleDone: (done: boolean) => void;
  onToggleCollapse: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onQuick: (mode: QuickKey) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function ItemRow({
  row,
  canEdit,
  today,
  locale,
  selected,
  isMine,
  assignee,
  durationLabel,
  drop,
  dragging,
  registerInput,
  registerRow,
  onCommitName,
  onKeyDown,
  onToggleDone,
  onToggleCollapse,
  onOpen,
  onDelete,
  onQuick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ItemRowProps) {
  const t = useT();
  const { item, depth, isParent, visibleChildren, collapsed } = row;
  const done = item.progress >= 100;
  const overdue = !done && !!item.end_date && item.end_date < today;

  // Local draft of the name. Re-synced from the server value whenever that
  // changes and the field is not being edited (adjusting state during render,
  // not in an effect, so no frame shows the stale name).
  const [value, setValue] = useState(item.name);
  const [synced, setSynced] = useState(item.name);
  const [editing, setEditing] = useState(false);
  if (!editing && synced !== item.name) {
    setSynced(item.name);
    setValue(item.name);
  }

  const dateText = formatRange(item.start_date, item.end_date, locale);

  return (
    <div
      ref={registerRow}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group relative flex items-center gap-1.5 pr-2 h-9 border-b border-neutral-100 dark:border-neutral-800/60',
        'hover:bg-neutral-50 dark:hover:bg-neutral-900/60 focus-within:bg-neutral-50 dark:focus-within:bg-neutral-900/60',
        selected && 'bg-blue-50/70 dark:bg-blue-950/30',
        dragging && 'opacity-40',
        drop === 'on' && 'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-inset ring-blue-400',
      )}
      style={{ paddingLeft: indentPx(depth) }}
    >
      {drop && drop !== 'on' && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-0 h-0.5 bg-blue-500',
            drop === 'before' ? '-top-px' : '-bottom-px',
          )}
          style={{ left: indentPx(depth) + 16 }}
        />
      )}

      {/* Drag handle. Only the handle is draggable so the name stays selectable text. */}
      <span
        draggable={canEdit}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={canEdit ? t('tasks.outline.drag') : undefined}
        className={cn(
          'shrink-0 flex items-center text-neutral-300 dark:text-neutral-600',
          canEdit
            ? 'cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 hover:text-neutral-500'
            : 'invisible',
        )}
      >
        <GripVertical size={12} />
      </span>

      {visibleChildren > 0 || (isParent && collapsed) ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('tasks.outline.expand') : t('tasks.outline.collapse')}
          title={collapsed ? t('tasks.outline.expand') : t('tasks.outline.collapse')}
          className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      ) : (
        <span className="shrink-0 w-4" />
      )}

      {isParent ? (
        // Summary rows roll their dates and progress up from their children
        // (work_items_rollup), so ticking one would silently revert.
        <span
          className="shrink-0 h-4 w-4 flex items-center justify-center text-neutral-400 dark:text-neutral-500"
          title={t('tasks.rollupHint')}
        >
          <ListTree size={13} />
        </span>
      ) : (
        // Disabled inputs swallow pointer events, so the title lives on the wrapper.
        <span className="shrink-0 flex" title={canEdit ? undefined : t('tasks.readOnly')}>
          <input
            type="checkbox"
            tabIndex={-1}
            checked={done}
            disabled={!canEdit}
            onChange={(e) => onToggleDone(e.target.checked)}
            aria-label={item.name}
            className="h-4 w-4 accent-emerald-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          />
        </span>
      )}

      <input
        ref={registerInput}
        value={value}
        readOnly={!canEdit}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value !== item.name) onCommitName(value);
          else setValue(item.name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setValue(item.name);
            // Blur on the next frame, once the reverted value has rendered, so
            // the blur handler sees nothing to commit.
            const el = e.currentTarget;
            requestAnimationFrame(() => el.blur());
            return;
          }
          onKeyDown(e);
        }}
        aria-label={t('tasks.outline.nameLabel')}
        spellCheck
        className={cn(
          'flex-1 min-w-0 bg-transparent text-sm outline-none rounded px-1 -mx-1',
          'focus:bg-white dark:focus:bg-neutral-950 focus:ring-1 focus:ring-neutral-300 dark:focus:ring-neutral-700',
          isParent && 'font-medium',
          done && 'line-through text-neutral-400 dark:text-neutral-500',
          !canEdit && 'cursor-default',
        )}
      />

      {isMine && !done && !isParent && (
        <span
          title={t('tasks.assignedToMe')}
          className="shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500"
        />
      )}

      <button
        type="button"
        tabIndex={-1}
        onClick={() => onQuick('d')}
        disabled={!canEdit && !item.description}
        title={
          item.description
            ? `${item.description.slice(0, 200)}${item.description.length > 200 ? '…' : ''}`
            : `${t('tasks.quick.description')} (${modLabel}+D)`
        }
        aria-label={t('tasks.quick.description')}
        className={cn(
          'shrink-0 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700',
          item.description
            ? 'text-neutral-500 dark:text-neutral-400'
            : 'text-neutral-300 dark:text-neutral-600 opacity-0 group-hover:opacity-100 disabled:hidden',
        )}
      >
        <AlignLeft size={13} />
      </button>

      {(isParent || (item.progress > 0 && !done)) && (
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {item.progress}%
        </span>
      )}

      <button
        type="button"
        tabIndex={-1}
        onClick={() => onQuick('t')}
        disabled={!canEdit || isParent}
        title={
          isParent
            ? t('workItem.dateReason')
            : `${durationLabel ? `${durationLabel} · ` : ''}${t('tasks.quick.duration')} (${modLabel}+T)`
        }
        className={cn(
          'shrink-0 text-[11px] tabular-nums rounded px-1 enabled:hover:bg-neutral-200 dark:enabled:hover:bg-neutral-700',
          overdue
            ? 'text-red-600 dark:text-red-400 font-medium'
            : 'text-neutral-400 dark:text-neutral-500',
        )}
      >
        {dateText}
      </button>

      <button
        type="button"
        tabIndex={-1}
        onClick={() => onQuick('a')}
        disabled={!canEdit}
        title={
          assignee
            ? `${assignee.display_name} · ${t('tasks.quick.assignee')} (${modLabel}+A)`
            : `${t('tasks.unassigned')} · ${t('tasks.quick.assignee')} (${modLabel}+A)`
        }
        className="shrink-0 rounded-full disabled:cursor-default"
      >
        {assignee ? (
          <Avatar user={assignee} size="xs" title="" />
        ) : (
          <span className="block h-5 w-5 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700" />
        )}
      </button>

      <button
        type="button"
        tabIndex={-1}
        onClick={onOpen}
        title={t('tasks.outline.openDetails')}
        aria-label={t('tasks.outline.openDetails')}
        className="shrink-0 p-1 rounded text-neutral-400 dark:text-neutral-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        <PanelRightOpen size={13} />
      </button>

      <button
        type="button"
        tabIndex={-1}
        onClick={onDelete}
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

interface DraftRowProps {
  depth: number;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  registerInput: (el: HTMLInputElement | null) => void;
}

// The line a new task is typed into. It is not a work item yet — it becomes one
// on Enter (or on blur, if something was typed).
export function DraftRow({ depth, value, onChange, onKeyDown, onBlur, registerInput }: DraftRowProps) {
  const t = useT();
  return (
    <div
      className="flex items-center gap-1.5 pr-2 h-9 border-b border-neutral-100 dark:border-neutral-800/60 bg-neutral-50/60 dark:bg-neutral-900/40"
      style={{ paddingLeft: indentPx(depth) }}
    >
      <span className="shrink-0 w-3" />
      <span className="shrink-0 w-4" />
      <span className="shrink-0 h-4 w-4 rounded border border-dashed border-neutral-300 dark:border-neutral-600" />
      <input
        ref={registerInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        placeholder={depth > 0 ? t('tasks.outline.subtaskPlaceholder') : t('tasks.addPlaceholder')}
        aria-label={t('tasks.outline.newTaskLabel')}
        className="flex-1 min-w-0 bg-transparent text-sm outline-none px-1 -mx-1 placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
      />
      <span className="shrink-0 hidden md:block text-[10px] text-neutral-400 dark:text-neutral-500">
        {t('tasks.outline.draftHint')}
      </span>
    </div>
  );
}
