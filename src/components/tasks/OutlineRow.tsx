import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, ListTree, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { modLabel, quickKeyOf, type QuickKey } from '@/lib/platform';
import { formatRange, isMultilineDescription } from '@/lib/taskFormat';
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
  /** The description beside the name, muted and cut to the row. */
  showDescription: boolean;
  isMine: boolean;
  assignee: TasksPerson | undefined;
  durationLabel: string;
  drop: DropPos | null;
  dragging: boolean;
  registerInput: (el: HTMLInputElement | null) => void;
  registerDescInput: (el: HTMLInputElement | null) => void;
  registerRow: (el: HTMLDivElement | null) => void;
  onCommitName: (name: string) => void;
  onCommitDescription: (text: string) => void;
  /**
   * Keys the outline handles (Enter, Tab, arrows, quick-edit). The name itself
   * is committed on blur only — every one of those actions moves focus anyway,
   * and committing in both places would send the rename twice.
   */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggleDone: (done: boolean) => void;
  onToggleCollapse: () => void;
  /** Open the details panel; 'description' puts the cursor in it. */
  onOpen: (focus?: 'description') => void;
  onDelete: () => void;
  onQuick: (mode: QuickKey) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

// The row is data-keep-drawer: a click on it opens (or switches) the details
// panel. Its controls are data-drawer-close: a click on one of those is a
// click elsewhere, which closes an open panel.
export function ItemRow({
  row,
  canEdit,
  today,
  locale,
  selected,
  showDescription,
  isMine,
  assignee,
  durationLabel,
  drop,
  dragging,
  registerInput,
  registerDescInput,
  registerRow,
  onCommitName,
  onCommitDescription,
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
  const nameRef = useRef<HTMLInputElement | null>(null);

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

  // The description, the same way. One with line breaks shows on one line and
  // is only edited in the panel.
  const multiline = isMultilineDescription(item.description);
  const descEditable = canEdit && !multiline;
  const descShown = multiline ? item.description!.replace(/\s+/g, ' ').trim() : (item.description ?? '');
  const [desc, setDesc] = useState(descShown);
  const [descSynced, setDescSynced] = useState(descShown);
  const [descEditing, setDescEditing] = useState(false);
  if (!descEditing && descSynced !== descShown) {
    setDescSynced(descShown);
    setDesc(descShown);
  }
  // Hidden (but still there for Alt+D to focus) when switched off or empty.
  const descVisible = descEditing || (showDescription && !!descShown);
  const descPlaceholder = t('tasks.outline.descriptionPlaceholder');
  const descTitle = item.description
    ? `${item.description.slice(0, 200)}${item.description.length > 200 ? '…' : ''}`
    : undefined;

  const dateText = formatRange(item.start_date, item.end_date, locale);

  // A click on the row that misses its controls opens the details panel. The
  // name and description are left to inline editing — unless they can't be
  // edited here, and then the panel opens (on the description, with the
  // cursor in it).
  function onRowClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (el.closest('button, [data-drawer-close]')) return;
    // Selecting text with the mouse ends in a click too.
    if (window.getSelection()?.toString()) return;
    onOpen(el.closest('[data-row-desc]') ? 'description' : undefined);
  }

  function backToName() {
    const el = nameRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }

  return (
    <div
      ref={registerRow}
      data-keep-drawer
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onRowClick}
      className={cn(
        'group relative flex items-center gap-1.5 pr-2 h-9 border-b border-neutral-100 dark:border-neutral-800/60 cursor-pointer',
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
        data-drawer-close
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
          data-drawer-close
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
        <span data-drawer-close className="shrink-0 flex" title={canEdit ? undefined : t('tasks.readOnly')}>
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

      {/* Name, description and free space. The name keeps its full width (it is
          only cut once it alone outgrows the row); the description gets what
          is left, and the rest is free to click. */}
      <div className="flex-1 min-w-0 self-stretch flex items-center">
        {/* Sized to the name: the invisible copy sets the width and the input
            lies over it. */}
        <div className="relative shrink-0 max-w-full min-w-8 -ml-1 overflow-hidden">
          <span
            aria-hidden
            className={cn('invisible block whitespace-pre px-1 text-sm', isParent && 'font-medium')}
          >
            {/* The trailing space leaves room for the caret. */}
            {`${value} `}
          </span>
          <input
            ref={(el) => {
              nameRef.current = el;
              registerInput(el);
            }}
            data-drawer-close={canEdit ? '' : undefined}
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
              'absolute inset-0 w-full bg-transparent text-sm outline-none rounded px-1',
              'focus:bg-white dark:focus:bg-neutral-950 focus:ring-1 focus:ring-inset focus:ring-neutral-300 dark:focus:ring-neutral-700',
              isParent && 'font-medium',
              done && 'line-through text-neutral-400 dark:text-neutral-500',
              !canEdit && 'cursor-pointer',
            )}
          />
        </div>

        {/* The description, edited in place like the name. The two fields'
            padding is the space between them. */}
        <div
          data-row-desc
          title={descEditing ? undefined : descTitle}
          className={cn(
            'relative overflow-hidden',
            !descVisible ? 'w-0 flex-none' : descEditing ? 'flex-1 min-w-0' : 'flex-[0_1_auto] min-w-0',
          )}
        >
          <span aria-hidden className="invisible block whitespace-pre px-1 text-xs">
            {`${desc || (descEditing ? descPlaceholder : '')} `}
          </span>
          <input
            ref={registerDescInput}
            data-drawer-close={descEditable ? '' : undefined}
            value={desc}
            readOnly={!descEditable}
            tabIndex={descVisible ? undefined : -1}
            placeholder={descPlaceholder}
            onChange={(e) => setDesc(e.target.value)}
            onFocus={() => setDescEditing(true)}
            onBlur={() => {
              setDescEditing(false);
              if (descEditable && desc.trim() !== (item.description ?? '').trim()) {
                onCommitDescription(desc.trim());
              } else {
                setDesc(descShown);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setDesc(descShown);
                // As for the name: leave once the reverted text has rendered.
                requestAnimationFrame(backToName);
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                backToName();
                return;
              }
              // Alt+A / Alt+T and moving between tasks work from here too.
              const quick = quickKeyOf(e);
              if (quick === 'd') {
                e.preventDefault();
                return;
              }
              const plainArrow =
                (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
              if (quick || plainArrow) onKeyDown(e);
            }}
            aria-label={t('tasks.outline.descriptionLabel')}
            spellCheck
            className={cn(
              'absolute inset-0 w-full bg-transparent text-xs outline-none rounded px-1',
              'text-neutral-400 dark:text-neutral-500 placeholder:text-neutral-400 dark:placeholder:text-neutral-600',
              'focus:bg-white dark:focus:bg-neutral-950 focus:ring-1 focus:ring-inset focus:ring-neutral-300 dark:focus:ring-neutral-700',
              'focus:text-neutral-700 dark:focus:text-neutral-200',
              descEditable ? 'hover:text-neutral-600 dark:hover:text-neutral-300' : 'cursor-pointer',
            )}
          />
        </div>

        {/* Free space: a click here opens the panel. */}
        <span className="flex-1 self-stretch" />
      </div>

      {isMine && !done && !isParent && (
        <span
          title={t('tasks.assignedToMe')}
          className="shrink-0 h-1.5 w-1.5 rounded-full bg-blue-500"
        />
      )}

      {(isParent || (item.progress > 0 && !done)) && (
        <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
          {item.progress}%
        </span>
      )}

      <button
        type="button"
        data-drawer-close
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
        data-drawer-close
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
        data-drawer-close
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
