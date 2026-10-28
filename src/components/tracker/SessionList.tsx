import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  pushRecent,
  useActiveTimer,
  useDeleteTimeEntry,
  useMyTimeEntries,
  useStartTimer,
  useUpdateTimeEntry,
  type UpdateEntryInput,
} from '@/hooks/useTimeEntries';
import { entryInOrg, useTrackerCatalog, workItemPath, type TrackerCatalog } from '@/hooks/useTrackerCatalog';
import { useCurrentOrg } from '@/lib/currentOrg';
import {
  combineDateTime,
  daysApart,
  durationMs,
  formatHM,
  formatWeekLabel,
  formatDateHuman,
  isoDate,
  isoTime,
  parseDurationText,
  sessionRange,
  weekStartIso,
} from '@/lib/timeFormat';
import { cn } from '@/lib/utils';
import type { TimeEntry, TrackerTarget } from '@/types/db';
import { SessionEditDialog } from './SessionEditDialog';
import { NextDayMark } from './ManualEntryForm';
import { TargetPathText } from './TaskTargetPicker';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';

interface Props {
  /** Called after a timer is started from a past session. */
  onResumed?: (target: TrackerTarget) => void;
}

export function SessionList({ onResumed }: Props) {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const { org } = useCurrentOrg();
  const { data: allEntries = [] } = useMyTimeEntries();
  // My sessions in the current organization.
  const entries = useMemo(
    () => (catalog ? allEntries.filter((e) => entryInOrg(e.project_id, catalog, org.id)) : allEntries),
    [allEntries, catalog, org.id],
  );
  const { data: active } = useActiveTimer();
  const del = useDeleteTimeEntry();
  const start = useStartTimer();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  // Whether a past session's task can be timed again right now.
  function resumeState(target: TrackerTarget): ResumeState {
    if (start.isPending || !catalog) return 'busy';
    if (active && groupKey(active) === groupKey(target)) return 'running';
    // Imported or old entries can point at a project or task you no longer
    // have; start_time_entry would reject those.
    if (!catalog.projects.some((p) => p.id === target.project_id && p.org_id === org.id)) return 'unavailable';
    if (target.work_item_id && !catalog.workItems.some((w) => w.id === target.work_item_id)) {
      return 'unavailable';
    }
    return 'ok';
  }

  // start_time_entry stops whatever is running first, so this doubles as
  // "switch to this task".
  async function onResume(target: TrackerTarget) {
    pushRecent(target);
    try {
      await start.mutateAsync(target);
      toast.success(t('tracker.timerStarted'));
      onResumed?.(target);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  // Group: week → day → groupKey → entries
  const tree = useMemo(() => groupEntries(entries), [entries]);

  async function onDelete(e: TimeEntry) {
    if (!confirm(t('tracker.deleteConfirm'))) return;
    try {
      await del.mutateAsync(e.id);
      toast.success(t('tracker.entryDeleted'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (!entries.length) {
    return (
      <div className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-10">
        {t('tracker.noSessions')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tree.map((week) => (
        <WeekBlock
          key={week.weekStart}
          week={week}
          catalog={catalog}
          onEdit={setEditing}
          onDelete={onDelete}
          resumeState={resumeState}
          onResume={onResume}
        />
      ))}
      {editing && (
        <SessionEditDialog
          entry={editing}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
    </div>
  );
}

// ----- Tree types ------------------------------------------------------------

interface GroupNode {
  key: string;
  project_id: string;
  work_item_id: string | null;
  custom_task_text: string | null;
  totalMs: number;
  entries: TimeEntry[];
}

interface DayNode {
  date: string;
  totalMs: number;
  groups: GroupNode[];
}

interface WeekNode {
  weekStart: string;
  totalMs: number;
  days: DayNode[];
}

function groupEntries(entries: TimeEntry[]): WeekNode[] {
  const byWeek = new Map<string, WeekNode>();

  for (const e of entries) {
    if (!e.end_at) continue; // skip running timer
    const start = new Date(e.start_at);
    const dayKey = isoDate(start);
    const weekKey = weekStartIso(start);
    const ms = durationMs(e.start_at, e.end_at);

    let week = byWeek.get(weekKey);
    if (!week) {
      week = { weekStart: weekKey, totalMs: 0, days: [] };
      byWeek.set(weekKey, week);
    }
    week.totalMs += ms;

    let day = week.days.find((d) => d.date === dayKey);
    if (!day) {
      day = { date: dayKey, totalMs: 0, groups: [] };
      week.days.push(day);
    }
    day.totalMs += ms;

    const gKey = groupKey(e);
    let g = day.groups.find((x) => x.key === gKey);
    if (!g) {
      g = {
        key: gKey,
        project_id: e.project_id,
        work_item_id: e.work_item_id,
        custom_task_text: e.custom_task_text,
        totalMs: 0,
        entries: [],
      };
      day.groups.push(g);
    }
    g.totalMs += ms;
    g.entries.push(e);
  }

  const weeks = Array.from(byWeek.values()).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  for (const w of weeks) {
    w.days.sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const d of w.days) {
      d.groups.sort((a, b) => b.totalMs - a.totalMs);
      for (const g of d.groups) {
        g.entries.sort((a, b) => (a.start_at < b.start_at ? 1 : -1));
      }
    }
  }
  return weeks;
}

function groupKey(e: TrackerTarget): string {
  return `${e.project_id}|${e.work_item_id ?? ''}|${e.custom_task_text ?? ''}`;
}

// ----- Components ------------------------------------------------------------

type ResumeState = 'ok' | 'running' | 'unavailable' | 'busy';

interface ResumeProps {
  resumeState: (target: TrackerTarget) => ResumeState;
  onResume: (target: TrackerTarget) => void;
}

function ResumeButton({ state, onClick }: { state: ResumeState; onClick: () => void }) {
  const t = useT();
  const title =
    state === 'running'
      ? t('tracker.resumeRunning')
      : state === 'unavailable'
        ? t('tracker.resumeUnavailable')
        : t('tracker.resume');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== 'ok'}
      aria-label={title}
      title={title}
      className={[
        'h-5 w-5 flex items-center justify-center rounded shrink-0 disabled:cursor-not-allowed',
        state === 'running'
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-500',
      ].join(' ')}
    >
      {state === 'running' ? (
        <span className="block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      ) : (
        <Play size={12} />
      )}
    </button>
  );
}

function WeekBlock({
  week,
  catalog,
  onEdit,
  onDelete,
  ...resume
}: {
  week: WeekNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
} & ResumeProps) {
  // Weeks are the indigo bands; days and tasks stay neutral or take their
  // project's colour, so the three levels never look alike.
  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/70 overflow-hidden bg-white dark:bg-neutral-950">
      <div className="flex items-center gap-4 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/50 border-b border-indigo-200 dark:border-indigo-900/70">
        <div className="flex-1 min-w-0 text-sm font-semibold text-indigo-950 dark:text-indigo-100">
          {formatWeekLabel(week.weekStart)}
        </div>
        <WeekStrip week={week} />
        <div className="text-base font-mono font-semibold tabular-nums text-indigo-900 dark:text-indigo-100">
          {formatHM(week.totalMs)}
        </div>
      </div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {week.days.map((day) => (
          <DayBlock key={day.date} day={day} catalog={catalog} onEdit={onEdit} onDelete={onDelete} {...resume} />
        ))}
      </div>
    </div>
  );
}

// Hours per weekday, Monday first, as small bars: the week's shape at a glance.
// A full 8-hour day fills a bar unless a longer day sets the scale.
function WeekStrip({ week }: { week: WeekNode }) {
  const monday = new Date(week.weekStart + 'T00:00:00');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return { date: d, ms: week.days.find((x) => x.date === isoDate(d))?.totalMs ?? 0 };
  });
  const max = Math.max(8 * 3_600_000, ...days.map((d) => d.ms));
  return (
    <div className="hidden sm:flex items-end gap-1 shrink-0" aria-hidden>
      {days.map(({ date, ms }) => (
        <div
          key={date.getDay()}
          title={`${formatDateHuman(date)} · ${formatHM(ms)}`}
          className="flex flex-col items-center gap-0.5"
        >
          <div className="w-3.5 h-5 rounded-sm bg-indigo-100 dark:bg-indigo-900/50 flex items-end overflow-hidden">
            <div className="w-full bg-indigo-500 dark:bg-indigo-400" style={{ height: `${(ms / max) * 100}%` }} />
          </div>
          <span className="text-[9px] leading-none text-indigo-700/80 dark:text-indigo-300/80">
            {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        </div>
      ))}
    </div>
  );
}

function DayBlock({
  day,
  catalog,
  onEdit,
  onDelete,
  ...resume
}: {
  day: DayNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
} & ResumeProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const date = new Date(day.date + 'T00:00:00');
  const isToday = day.date === isoDate(new Date());
  // The date sits in its own column beside the day's tasks (above them on a
  // phone), so the day header doesn't add another row to the stack.
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sm:w-24 shrink-0 self-start flex sm:flex-col items-baseline sm:items-start gap-x-2 rounded px-1 -mx-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        <span
          className={cn(
            'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide',
            isToday ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-400',
          )}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {date.toLocaleDateString(undefined, { weekday: 'short' })}
        </span>
        <span
          className={cn(
            'text-sm font-semibold',
            isToday ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-800 dark:text-neutral-100',
          )}
        >
          {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
        <span className="ml-auto sm:ml-0 sm:mt-0.5 text-sm font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
          {formatHM(day.totalMs)}
        </span>
      </button>
      {open ? (
        <div className="flex-1 min-w-0 space-y-1.5">
          {day.groups.map((g) => (
            <GroupBlock key={g.key} group={g} catalog={catalog} onEdit={onEdit} onDelete={onDelete} {...resume} />
          ))}
        </div>
      ) : (
        // Collapsed: one dot per task in its project's colour.
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 sm:pt-1.5">
          {day.groups.map((g) => (
            <span
              key={g.key}
              title={targetLabel(g.project_id, g.work_item_id, g.custom_task_text, catalog, t).join(' › ')}
              className={cn('h-2.5 w-2.5 rounded-full', projectHue(g.project_id).stripe)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A colour per project, picked from its id so it stays the same everywhere.
// Indigo is left out: it marks the weeks.
const HUES = [
  { stripe: 'bg-emerald-500', tint: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  { stripe: 'bg-sky-500', tint: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-700 dark:text-sky-400' },
  { stripe: 'bg-rose-500', tint: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-400' },
  { stripe: 'bg-amber-500', tint: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  { stripe: 'bg-violet-500', tint: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-400' },
  { stripe: 'bg-teal-500', tint: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-400' },
  { stripe: 'bg-orange-500', tint: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' },
  { stripe: 'bg-fuchsia-500', tint: 'bg-fuchsia-50 dark:bg-fuchsia-950/30', text: 'text-fuchsia-700 dark:text-fuchsia-400' },
  { stripe: 'bg-lime-500', tint: 'bg-lime-50 dark:bg-lime-950/30', text: 'text-lime-700 dark:text-lime-400' },
  { stripe: 'bg-cyan-500', tint: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-700 dark:text-cyan-400' },
] as const;

type Hue = (typeof HUES)[number];

function projectHue(projectId: string): Hue {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

function GroupBlock({
  group,
  catalog,
  onEdit,
  onDelete,
  resumeState,
  onResume,
}: {
  group: GroupNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
} & ResumeProps) {
  const t = useT();
  // Open by default: the entries are what you come to the list for.
  const [open, setOpen] = useState(true);
  const label = targetLabel(group.project_id, group.work_item_id, group.custom_task_text, catalog, t);
  const target: TrackerTarget = {
    project_id: group.project_id,
    work_item_id: group.work_item_id,
    custom_task_text: group.custom_task_text,
  };
  const state = resumeState(target);
  const hue = projectHue(group.project_id);

  // A card per task, edged and tinted in its project's colour. The play button
  // sits beside the expand toggle rather than inside it: a button can't contain
  // another button.
  return (
    <div className="flex rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div className={cn('w-1 shrink-0', hue.stripe)} />
      <div className="flex-1 min-w-0">
        <div className={cn('flex items-center', hue.tint)}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex-1 min-w-0 flex items-center justify-between gap-3 pl-2 pr-3 py-1.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
              <PathLabel parts={label} trailClass={hue.text} />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {group.entries.length > 1 && (
                <span className="rounded-full px-1.5 text-[11px] tabular-nums bg-white/70 dark:bg-neutral-900/70 text-neutral-500 dark:text-neutral-400">
                  ×{group.entries.length}
                </span>
              )}
              <span className="text-sm font-mono font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">{formatHM(group.totalMs)}</span>
            </div>
          </button>
          <div className="pr-3">
            <ResumeButton state={state} onClick={() => onResume(target)} />
          </div>
        </div>
        {open && (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/70 border-t border-neutral-200/70 dark:border-neutral-800">
            {group.entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                onEdit={onEdit}
                onDelete={onDelete}
                resumeState={state}
                onResume={() => onResume(target)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Note, start, end and duration are edited in place: each saves when it loses
// focus (or on Enter) and Escape puts it back. The pencil opens the full dialog
// for the date and the task.
function EntryRow({
  entry,
  onEdit,
  onDelete,
  resumeState,
  onResume,
}: {
  entry: TimeEntry;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
  resumeState: ResumeState;
  onResume: () => void;
}) {
  const t = useT();
  const update = useUpdateTimeEntry();
  const ms = durationMs(entry.start_at, entry.end_at);
  const startD = new Date(entry.start_at);
  // The list skips the running entry, so there is always an end.
  const endD = entry.end_at ? new Date(entry.end_at) : new Date(startD);
  const endDays = daysApart(startD, endD);

  async function save(patch: UpdateEntryInput['patch']): Promise<boolean> {
    try {
      await update.mutateAsync({ id: entry.id, patch });
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  }

  function saveNotes(v: string) {
    const next = v.trim() || null;
    if (next === (entry.notes ?? null)) return true;
    return save({ notes: next });
  }

  // Only the edited field is written, so the other end keeps its seconds.
  function saveStart(time: string) {
    if (!time) return false;
    const s = combineDateTime(isoDate(startD), time);
    if (s >= endD) {
      toast.error(t('tracker.endBeforeStart'));
      return false;
    }
    return save({ start_at: s.toISOString() });
  }

  // An end before the start runs past midnight, as in manual entry.
  function saveEnd(time: string) {
    if (!time) return false;
    const e = sessionRange(isoDate(startD), isoTime(startD), time).end;
    if (e <= startD) {
      toast.error(t('tracker.endBeforeStart'));
      return false;
    }
    return save({ end_at: e.toISOString() });
  }

  function saveDuration(text: string) {
    const d = parseDurationText(text);
    if (d == null) {
      toast.error(t('tracker.durationInvalid'));
      return false;
    }
    return save({ end_at: new Date(startD.getTime() + d).toISOString() });
  }

  return (
    <div className="flex items-center pl-3.5 pr-3 py-0.5 gap-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
      <InlineInput
        value={entry.notes ?? ''}
        onCommit={saveNotes}
        placeholder={t('tracker.addNote')}
        aria-label={t('tracker.notesLabel')}
        title={entry.notes ?? undefined}
        className="flex-1 min-w-0 text-xs text-neutral-600 dark:text-neutral-300 placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
      />
      <InlineInput
        type="time"
        value={isoTime(startD)}
        onCommit={saveStart}
        aria-label={t('tracker.startTime')}
        className={timeClass}
      />
      <span className="text-neutral-400">–</span>
      <InlineInput
        type="time"
        value={isoTime(endD)}
        onCommit={saveEnd}
        aria-label={t('tracker.endTime')}
        className={timeClass}
      />
      <span className="w-7 shrink-0">{endDays > 0 && <NextDayMark days={endDays} date={endD} />}</span>
      <InlineInput
        value={formatHM(ms)}
        onCommit={saveDuration}
        aria-label={t('tracker.duration')}
        title={t('tracker.durationHint')}
        className="w-[4.75rem] shrink-0 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-300"
      />
      <div className="flex items-center gap-1 pl-1 shrink-0">
        <ResumeButton state={resumeState} onClick={onResume} />
        <button
          type="button"
          onClick={() => onEdit(entry)}
          aria-label={t('common.edit')}
          title={t('common.edit')}
          className="p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(entry)}
          aria-label={t('common.delete')}
          title={t('common.delete')}
          className="p-1 text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// Room for a 12-hour "PM"; the clock icon is hidden to keep the row compact.
const timeClass =
  'w-[5.5rem] shrink-0 tabular-nums text-neutral-700 dark:text-neutral-200 [&::-webkit-calendar-picker-indicator]:hidden';

// A borderless input that reads as text until hovered or focused. It keeps its
// own draft and calls onCommit only when the value changed; onCommit returning
// false puts the stored value back.
function InlineInput({
  value,
  onCommit,
  className,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => boolean | Promise<boolean>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
  const [draft, setDraft] = useState(value);
  // Follow the stored value when it changes (a save landing, an edit elsewhere).
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  // Escape blurs too; this stops that blur from saving.
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === value) return;
    if (!(await onCommit(draft))) setDraft(value);
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      autoComplete="off"
      className={cn(
        'h-7 rounded px-1.5 bg-transparent border border-transparent',
        'hover:border-neutral-300 dark:hover:border-neutral-700',
        'focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 focus:bg-white dark:focus:bg-neutral-950',
        className,
      )}
    />
  );
}

// Two lines so a deep path always fits: client › project › parent tasks small
// on top, the task itself below. Both wrap rather than cut off; hovering still
// shows the whole path on one line. The trail takes the project's colour.
function PathLabel({ parts, trailClass }: { parts: string[]; trailClass: string }) {
  const leaf = parts[parts.length - 1];
  const trail = parts.slice(0, -1);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0">
          {trail.length > 0 && (
            <div className={cn('flex flex-wrap items-center gap-x-1 text-[11px] leading-4 font-medium', trailClass)}>
              {trail.map((p, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0 break-words">
                  {i > 0 && <ChevronRight size={9} className="text-neutral-300 dark:text-neutral-600 shrink-0" />}
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="text-sm leading-5 font-medium text-neutral-900 dark:text-neutral-100 break-words">{leaf}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-md break-words">
        <TargetPathText parts={parts} />
      </TooltipContent>
    </Tooltip>
  );
}

function targetLabel(
  projectId: string,
  workItemId: string | null,
  customText: string | null,
  catalog: TrackerCatalog | undefined,
  t: (key: never) => string,
): string[] {
  if (!catalog) return ['…'];
  const project = catalog.projects.find((p) => p.id === projectId);
  if (!project) return ['—'];
  // i18n: use literal fallback if t lookup is awkward here
  const noClient = '—';
  const noTask = 'No task';
  const out: string[] = [project.client_name ?? noClient, project.name];
  if (workItemId) {
    out.push(...workItemPath(workItemId, catalog.workItems));
  } else if (customText) {
    out.push(`“${customText}”`);
  } else {
    out.push(noTask);
  }
  void t; // unused parameter to keep API symmetric
  return out;
}
