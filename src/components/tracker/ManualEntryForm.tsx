import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useCreateManualEntry, pushRecent } from '@/hooks/useTimeEntries';
import { TaskTargetPicker } from './TaskTargetPicker';
import { TargetSegments } from './TargetSegments';
import { NoteInput } from './NoteInput';
import {
  combineDateTime,
  daysApart,
  formatDateHuman,
  formatDurationText,
  formatHM,
  formatHMS,
  isoDate,
  isoTime,
  parseDurationText,
  sessionRange,
} from '@/lib/timeFormat';
import type { TrackerTarget } from '@/types/db';

interface Props {
  target: TrackerTarget | null;
  setTarget: (t: TrackerTarget | null) => void;
  /** The note, shared with the live timer so switching keeps it. */
  notes: string;
  setNotes: (v: string) => void;
  /** Rendered as the card's first row (the Live / Manual switch). */
  header?: React.ReactNode;
}

/** How the session's end is given: a clock time, or how long it took. */
type EndMode = 'end' | 'duration';

const END_MODE_KEY = 'vn.tracker.manual.endMode';

export function ManualEntryForm({ target, setTarget, notes, setNotes, header }: Props) {
  const t = useT();
  const create = useCreateManualEntry();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [date, setDate] = useState<string>(() => isoDate(new Date()));
  const [start, setStart] = useState<string>(() => isoTime(new Date(Date.now() - 60 * 60 * 1000)));
  const [end, setEnd] = useState<string>(() => isoTime(new Date()));
  const [endMode, setEndModeState] = useState<EndMode>(readEndMode);
  const [durationText, setDurationText] = useState('1:00');

  // 22:30 – 03:30 is an overnight session: the end falls on the next day. A
  // duration can run past midnight just the same.
  const durationMs = endMode === 'duration' ? parseDurationText(durationText) : null;
  const range =
    endMode === 'end'
      ? sessionRange(date, start, end)
      : (() => {
          const s = combineDateTime(date, start);
          return { start: s, end: new Date(s.getTime() + (durationMs ?? 0)) };
        })();
  const startDt = range.start;
  const endDt = range.end;
  const endDays = daysApart(startDt, endDt);
  const valid = endDt > startDt;
  const previewMs = valid ? endDt.getTime() - startDt.getTime() : 0;
  const invalidText = endMode === 'end' ? t('tracker.endBeforeStart') : t('tracker.durationInvalid');
  const statusText = valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : invalidText;

  // Switching carries the session over, so the same span shows the other way.
  function setEndMode(m: EndMode) {
    if (m === endMode) return;
    if (valid) {
      if (m === 'duration') setDurationText(formatDurationText(previewMs));
      else setEnd(isoTime(endDt));
    }
    setEndModeState(m);
    try {
      localStorage.setItem(END_MODE_KEY, m);
    } catch {
      // Storage unavailable — the choice just won't be remembered.
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) {
      toast.error(t('tracker.pickTargetFirst'));
      return;
    }
    if (!valid) {
      toast.error(invalidText);
      return;
    }
    try {
      await create.mutateAsync({
        project_id: target.project_id,
        work_item_id: target.work_item_id,
        custom_task_text: target.custom_task_text,
        notes: notes.trim() || null,
        start_at: startDt.toISOString(),
        end_at: endDt.toISOString(),
      });
      pushRecent(target);
      toast.success(t('tracker.entryAdded'));
      setNotes('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
      {header}
      {/* Same rows as the live timer: note · duration · action, then the target. */}
      <div className="flex items-center gap-2">
        <NoteInput
          value={notes}
          onChange={setNotes}
          onPickSuggestion={(s) => {
            setNotes(s.notes);
            setTarget(s.target);
          }}
          target={target}
          className="flex-1 min-w-0"
        />

        <div className="flex items-center gap-2 shrink-0">
          <div
            className={cn(
              'font-mono text-lg tabular-nums px-1',
              valid ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500',
            )}
            title={statusText}
          >
            {formatHMS(previewMs)}
          </div>
          <button
            type="submit"
            disabled={!target || !valid || create.isPending}
            aria-label={t('tracker.addEntry')}
            title={statusText}
            className="h-9 w-9 rounded-md flex items-center justify-center transition-colors shrink-0 bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <TargetSegments
        value={target}
        onPick={setTarget}
        onClear={() => setTarget(null)}
        onSearch={() => setPickerOpen(true)}
      />

      {/* Date, start, then the end as a time or a duration. Time widths leave
          room for a 12-hour "PM" beside the browser's clock icon. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label={t('tracker.date')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="w-[10.5rem] shrink-0"
        />
        <Input
          type="time"
          aria-label={t('tracker.startTime')}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
          className="w-[8.75rem] shrink-0"
        />
        <EndModeSwitch mode={endMode} setMode={setEndMode} />
        {endMode === 'end' ? (
          <Input
            type="time"
            aria-label={t('tracker.endTime')}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            className="w-[8.75rem] shrink-0"
          />
        ) : (
          <>
            <Input
              aria-label={t('tracker.duration')}
              title={t('tracker.durationHint')}
              placeholder={t('tracker.durationPlaceholder')}
              value={durationText}
              onChange={(e) => setDurationText(e.target.value)}
              autoComplete="off"
              className={cn('w-[6.5rem] shrink-0 tabular-nums', !valid && 'border-red-400 dark:border-red-700')}
            />
            {valid && (
              <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400" title={t('tracker.endTime')}>
                → {endDt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </>
        )}
        {valid && endDays > 0 && <NextDayMark days={endDays} date={endDt} />}
        <span
          className={cn(
            'text-[11px]',
            valid ? 'text-neutral-500 dark:text-neutral-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {statusText}
        </span>
      </div>

      <TaskTargetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={target}
        onPick={(t) => setTarget(t)}
      />
    </form>
  );
}

function EndModeSwitch({ mode, setMode }: { mode: EndMode; setMode: (m: EndMode) => void }) {
  const t = useT();
  return (
    <div className="inline-flex shrink-0 bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
      {(['end', 'duration'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={cn(
            'px-2.5 h-7 text-xs rounded',
            mode === m
              ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
          )}
        >
          {t(m === 'end' ? 'tracker.endTime' : 'tracker.duration')}
        </button>
      ))}
    </div>
  );
}

function readEndMode(): EndMode {
  try {
    return localStorage.getItem(END_MODE_KEY) === 'duration' ? 'duration' : 'end';
  } catch {
    return 'end';
  }
}

// "+1d" beside an end time that falls on a later day than the start.
export function NextDayMark({ days, date }: { days: number; date: Date }) {
  const t = useT();
  return (
    <span
      title={t('tracker.endsOn', { date: formatDateHuman(date) })}
      className="shrink-0 rounded px-1 text-[11px] font-medium tabular-nums bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
    >
      {t('tracker.plusDays', { n: days })}
    </span>
  );
}
