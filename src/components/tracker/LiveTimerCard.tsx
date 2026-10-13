import { useState } from 'react';
import { Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  useActiveTimer,
  useStartTimer,
  useStopTimer,
  useUpdateActiveTimer,
  pushRecent,
  type ActiveTimerPatch,
} from '@/hooks/useTimeEntries';
import { TaskTargetPicker } from './TaskTargetPicker';
import { TargetSegments } from './TargetSegments';
import { NoteInput, type NoteSuggestion } from './NoteInput';
import { formatHMS } from '@/lib/timeFormat';
import { useServerNow } from '@/lib/serverClock';
import type { TrackerTarget } from '@/types/db';

interface Props {
  target: TrackerTarget | null;
  setTarget: (t: TrackerTarget | null) => void;
  /** Rendered as the card's first row (the Live / Manual switch). */
  header?: React.ReactNode;
}

// Note · elapsed · start/stop on the first row, client › project › task on the
// second. While a timer runs, both the note and the target stay editable and
// are written to the running entry.
export function LiveTimerCard({ target, setTarget, header }: Props) {
  const t = useT();
  const { data: active } = useActiveTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const updateActive = useUpdateActiveTimer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const now = useServerNow(!!active);

  const running = !!active;
  // The optimistic row from a just-pressed Start can't be edited until the real one lands.
  const editable = !!active && active.id !== '__optimistic__';
  const liveElapsed = active ? Math.max(0, now - new Date(active.start_at).getTime()) : 0;

  // Show the running entry's note; clear the box when the timer stops. Adjusted
  // during render when the entry changes, so typing isn't overwritten by refetches.
  const activeId = active?.id ?? null;
  const [notesFor, setNotesFor] = useState<string | null>(null);
  if (activeId !== notesFor) {
    setNotesFor(activeId);
    setNotes(active?.notes ?? '');
  }

  const runningTarget: TrackerTarget | null = active
    ? {
        project_id: active.project_id,
        work_item_id: active.work_item_id,
        custom_task_text: active.custom_task_text,
      }
    : null;
  const displayTarget = runningTarget ?? target;

  async function onStart() {
    if (!target) {
      toast.error(t('tracker.pickTargetFirst'));
      return;
    }
    pushRecent(target);
    try {
      await start.mutateAsync({
        project_id: target.project_id,
        work_item_id: target.work_item_id,
        custom_task_text: target.custom_task_text,
        notes: notes.trim() || null,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onStop() {
    await saveNotes();
    try {
      await stop.mutateAsync();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveNotes() {
    if (!active || !editable) return;
    const next = notes.trim() || null;
    if (next === (active.notes ?? null)) return;
    try {
      await updateActive.mutateAsync({ notes: next });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onPick(tg: TrackerTarget) {
    setTarget(tg);
    if (!running) return;
    // Re-target the running session as a whole.
    pushRecent(tg);
    try {
      await updateActive.mutateAsync({
        project_id: tg.project_id,
        work_item_id: tg.work_item_id,
        custom_task_text: tg.custom_task_text,
      });
      toast.success(t('tracker.timerRetargeted'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // An earlier note brings its task along. While running, both go onto the
  // running entry in one write.
  async function onSuggestion(s: NoteSuggestion) {
    setNotes(s.notes);
    setTarget(s.target);
    if (!editable || !runningTarget) return;
    const retarget = targetKey(s.target) !== targetKey(runningTarget);
    const patch: ActiveTimerPatch = retarget ? { notes: s.notes, ...s.target } : { notes: s.notes };
    if (retarget) pushRecent(s.target);
    try {
      await updateActive.mutateAsync(patch);
      if (retarget) toast.success(t('tracker.timerRetargeted'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
      {header}
      <div className="flex items-center gap-2">
        <NoteInput
          value={notes}
          onChange={setNotes}
          onPickSuggestion={onSuggestion}
          target={displayTarget}
          onBlur={saveNotes}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (running) e.currentTarget.blur();
            else if (target) void onStart();
          }}
          className="flex-1 min-w-0"
        />

        <div className="flex items-center gap-2 shrink-0">
          {running && (
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden />
          )}
          <div className="font-mono text-lg tabular-nums px-1 text-neutral-900 dark:text-neutral-100">
            {formatHMS(liveElapsed)}
          </div>
          <button
            type="button"
            onClick={running ? onStop : onStart}
            disabled={(!running && !target) || start.isPending || stop.isPending}
            aria-label={running ? t('tracker.stop') : t('tracker.start')}
            title={running ? t('tracker.stop') : t('tracker.start')}
            className={[
              'h-9 w-9 rounded-md flex items-center justify-center transition-colors shrink-0',
              running
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900 hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {running ? <Square size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>

      <TargetSegments
        value={displayTarget}
        onPick={onPick}
        onClear={running ? undefined : () => setTarget(null)}
        onSearch={() => setPickerOpen(true)}
        // The optimistic row from a just-pressed Start can't be re-targeted yet.
        disabled={running && !editable}
        title={running ? t('tracker.changeRunningTarget') : undefined}
      />

      <TaskTargetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={displayTarget}
        onPick={onPick}
      />
    </div>
  );
}

function targetKey(t: TrackerTarget): string {
  return `${t.project_id}|${t.work_item_id ?? ''}|${t.custom_task_text ?? ''}`;
}
