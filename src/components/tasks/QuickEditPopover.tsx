import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { CalendarCheck, Check, Clock, User } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { quickKeyOf, quickLabel, type QuickKey } from '@/lib/platform';
import { parseQuickDuration } from '@/lib/duration';
import { parseDate } from '@/components/gantt/ganttUtils';
import type { TasksPerson } from '@/hooks/useTasksData';
import type { WorkItem } from '@/types/db';

export interface DurationPreview {
  start: string;
  end: string;
}

/** The dates an end date would produce, or why it can't be used. */
export type EndPreview = (DurationPreview & { label: string }) | { error: string };

/** The panes the pop-up has. The note (description) is edited in the row itself. */
export type QuickPane = Exclude<QuickKey, 'note'>;

interface Props {
  item: WorkItem;
  mode: QuickPane;
  isParent: boolean;
  members: TasksPerson[];
  durationLabel: string;
  locale: string;
  /** Resolves a duration in working days to the dates it would produce. */
  previewDuration: (workDays: number) => DurationPreview | null;
  /** Resolves an end date (ISO) to the span it would produce. */
  previewEnd: (end: string) => EndPreview;
  /** Another shortcut pressed in the pop-up — 'note' means the row's description. */
  onModeChange: (mode: QuickKey) => void;
  onClose: () => void;
  onSaveAssignee: (userId: string | null) => void;
  onSaveDuration: (workDays: number) => void;
  onSaveEnd: (end: string) => void;
}

// One pop-up in the middle of the screen, three panes. The same Alt/⌘ shortcuts
// that open it switch between panes, committing the current one first — so
// assignee → duration (or end date) can be filled in one go without touching
// the mouse.
export function QuickEditPopover(props: Props) {
  const { mode, onClose, onModeChange } = props;
  const t = useT();
  // Each pane registers how to commit what it holds, so switching panes or
  // clicking away keeps the typing instead of dropping it.
  const commitRef = useRef<(() => void) | null>(null);

  function switchTo(next: QuickKey) {
    if (next === mode) return;
    commitRef.current?.();
    commitRef.current = null;
    onModeChange(next);
  }

  // Shared by every pane's input.
  function paneKeys(e: React.KeyboardEvent): boolean {
    const k = quickKeyOf(e);
    if (!k) return false;
    e.preventDefault();
    e.stopPropagation();
    switchTo(k);
    return true;
  }

  const tabs: { key: QuickPane; icon: React.ReactNode; label: string }[] = [
    { key: 'assign', icon: <User size={12} />, label: t('tasks.quick.assignee') },
    { key: 'duration', icon: <Clock size={12} />, label: t('tasks.quick.duration') },
    { key: 'end', icon: <CalendarCheck size={12} />, label: t('tasks.quick.endDate') },
  ];

  return (
    <RD.Root open onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        {/* data-keep-drawer: a click here is about the pop-up, so an open
            details panel stays open. */}
        <RD.Overlay data-keep-drawer className="fixed inset-0 z-40 bg-black/20" />
        <RD.Content
          data-keep-drawer
          aria-describedby={undefined}
          // Focus goes back to the row by the outline itself, which knows
          // whether the row still exists.
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={() => commitRef.current?.()}
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-80 max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl text-neutral-900 dark:text-neutral-100"
        >
          {/* Equal columns that may shrink: icon + label + shortcut on one line
              can be wider than the card, more so in Afrikaans. */}
          <div className="grid grid-cols-3 gap-1 px-2 pt-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                title={`${tab.label} (${quickLabel(tab.key)})`}
                onClick={() => switchTo(tab.key)}
                className={cn(
                  'min-w-0 flex flex-col items-center gap-0.5 px-1 py-1 rounded text-[11px]',
                  mode === tab.key
                    ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100',
                )}
              >
                <span className="flex items-center gap-1 max-w-full min-w-0">
                  <span className="shrink-0">{tab.icon}</span>
                  <span className="truncate">{tab.label}</span>
                </span>
                <kbd className="text-[9px] leading-none text-neutral-400">
                  {quickLabel(tab.key)}
                </kbd>
              </button>
            ))}
          </div>
          <RD.Title className="px-2 pt-1 pb-2 text-[11px] font-normal text-neutral-500 dark:text-neutral-400 truncate">
            {props.item.name}
          </RD.Title>
          <div className="border-t border-neutral-100 dark:border-neutral-800 p-2">
            {mode === 'assign' && <AssigneePane {...props} paneKeys={paneKeys} />}
            {mode === 'duration' && <DurationPane {...props} commitRef={commitRef} paneKeys={paneKeys} />}
            {mode === 'end' && <EndDatePane {...props} commitRef={commitRef} paneKeys={paneKeys} />}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

type PaneProps = Props & {
  paneKeys: (e: React.KeyboardEvent) => boolean;
  commitRef?: React.MutableRefObject<(() => void) | null>;
};

function AssigneePane({ item, members, onSaveAssignee, onClose, paneKeys }: PaneProps) {
  const t = useT();
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list: { id: string | null; label: string; person?: TasksPerson }[] = [
      { id: null, label: t('tasks.unassigned') },
      ...members.map((m) => ({ id: m.user_id, label: m.display_name, person: m })),
    ];
    if (!needle) return list;
    return list.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.person?.email ?? '').toLowerCase().includes(needle),
    );
  }, [q, members, t]);
  const [active, setActive] = useState(0);
  const clamped = Math.min(active, Math.max(0, options.length - 1));

  function pick(id: string | null) {
    if (id !== item.assignee_id) onSaveAssignee(id);
    onClose();
  }

  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (paneKeys(e)) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((clamped + 1) % Math.max(1, options.length));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((clamped - 1 + options.length) % Math.max(1, options.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[clamped];
            if (o) pick(o.id);
          }
        }}
        placeholder={t('tasks.quick.assigneeSearch')}
        className="w-full h-8 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600"
      />
      <ul className="mt-1 max-h-56 overflow-y-auto" role="listbox">
        {options.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-neutral-500">{t('tasks.quick.noMatches')}</li>
        )}
        {options.map((o, i) => (
          <li key={o.id ?? 'none'} role="option" aria-selected={i === clamped}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2 h-8 rounded text-left text-sm',
                i === clamped && 'bg-neutral-100 dark:bg-neutral-800',
              )}
            >
              {o.person ? (
                <Avatar user={o.person} size="xs" />
              ) : (
                <span className="h-5 w-5 rounded-full border border-dashed border-neutral-300 dark:border-neutral-700" />
              )}
              <span className="flex-1 truncate">{o.label}</span>
              {o.id === item.assignee_id && <Check size={13} className="text-emerald-600" />}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[10px] break-words text-neutral-400 dark:text-neutral-500">
        {t('tasks.quick.assigneeHint')}
      </div>
    </div>
  );
}

function DurationPane({
  isParent,
  durationLabel,
  locale,
  previewDuration,
  onSaveDuration,
  onClose,
  paneKeys,
  commitRef,
}: PaneProps) {
  const t = useT();
  const [text, setText] = useState(durationLabel);
  const days = parseQuickDuration(text);
  const preview = days ? previewDuration(days) : null;

  const commit = () => {
    if (isParent || !days || text.trim() === durationLabel) return;
    onSaveDuration(days);
  };
  useLayoutEffect(() => {
    if (commitRef) commitRef.current = commit;
  });

  if (isParent) {
    return (
      <div className="text-xs text-neutral-500 dark:text-neutral-400" tabIndex={-1}>
        {t('workItem.dateReason')}
        {/* Keeps the shortcuts working while this pane has nothing to type into. */}
        <input autoFocus readOnly onKeyDown={(e) => paneKeys(e)} className="sr-only" aria-hidden />
      </div>
    );
  }

  const fmt = (iso: string) =>
    parseDate(iso)?.toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) ?? iso;

  return (
    <div>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (paneKeys(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim() && !days) return;
            commit();
            if (commitRef) commitRef.current = null;
            onClose();
          }
        }}
        placeholder={t('workItem.durationPlaceholder')}
        className={cn(
          'w-full h-8 rounded border bg-white dark:bg-neutral-950 px-2 text-sm outline-none focus:ring-2',
          text.trim() && !days
            ? 'border-red-400 focus:ring-red-200 dark:focus:ring-red-900'
            : 'border-neutral-300 dark:border-neutral-700 focus:ring-neutral-300 dark:focus:ring-neutral-600',
        )}
      />
      <div className="mt-1 text-[11px] min-h-4 break-words">
        {text.trim() && !days ? (
          <span className="text-red-600 dark:text-red-400">{t('workItem.durationInvalid')}</span>
        ) : preview ? (
          <span className="text-neutral-600 dark:text-neutral-300">
            {t('tasks.quick.durationPreview', { start: fmt(preview.start), end: fmt(preview.end) })}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-[10px] break-words text-neutral-400 dark:text-neutral-500">
        {t('tasks.quick.durationHint')}
      </div>
    </div>
  );
}

function EndDatePane({
  item,
  isParent,
  locale,
  previewEnd,
  onSaveEnd,
  onClose,
  paneKeys,
  commitRef,
}: PaneProps) {
  const t = useT();
  const initial = item.end_date ?? '';
  const [value, setValue] = useState(initial);
  const plan = value ? previewEnd(value) : null;
  const ok = plan && !('error' in plan) ? plan : null;

  const commit = () => {
    if (isParent || !ok || value === initial) return;
    onSaveEnd(value);
  };
  useLayoutEffect(() => {
    if (commitRef) commitRef.current = commit;
  });

  if (isParent) {
    return (
      <div className="text-xs text-neutral-500 dark:text-neutral-400" tabIndex={-1}>
        {t('workItem.dateReason')}
        {/* Keeps the shortcuts working while this pane has nothing to type into. */}
        <input autoFocus readOnly onKeyDown={(e) => paneKeys(e)} className="sr-only" aria-hidden />
      </div>
    );
  }

  const fmt = (iso: string) =>
    parseDate(iso)?.toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }) ?? iso;

  return (
    <div>
      <input
        type="date"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (paneKeys(e)) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (value && !ok) return;
            commit();
            if (commitRef) commitRef.current = null;
            onClose();
          }
        }}
        aria-label={t('tasks.quick.endDate')}
        className={cn(
          'w-full h-8 rounded border bg-white dark:bg-neutral-950 px-2 text-sm outline-none focus:ring-2',
          plan && 'error' in plan
            ? 'border-red-400 focus:ring-red-200 dark:focus:ring-red-900'
            : 'border-neutral-300 dark:border-neutral-700 focus:ring-neutral-300 dark:focus:ring-neutral-600',
        )}
      />
      <div className="mt-1 text-[11px] min-h-4 break-words">
        {plan && 'error' in plan ? (
          <span className="text-red-600 dark:text-red-400">{plan.error}</span>
        ) : ok ? (
          <span className="text-neutral-600 dark:text-neutral-300">
            {t('tasks.quick.durationPreview', { start: fmt(ok.start), end: fmt(ok.end) })}
            {ok.label && ` · ${ok.label}`}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-[10px] break-words text-neutral-400 dark:text-neutral-500">
        {t('tasks.quick.endHint')}
      </div>
    </div>
  );
}
