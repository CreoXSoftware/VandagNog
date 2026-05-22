import { useEffect, useState } from 'react';
import { Play, Square, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';
import { useActiveTimer, useStartTimer, useStopTimer, pushRecent } from '@/hooks/useTimeEntries';
import { useTrackerCatalog } from '@/hooks/useTrackerCatalog';
import { TaskTargetPicker, TaskTargetTrigger, labelForTarget } from './TaskTargetPicker';
import { formatHMS } from '@/lib/timeFormat';
import type { TrackerTarget } from '@/types/db';

interface Props {
  target: TrackerTarget | null;
  setTarget: (t: TrackerTarget | null) => void;
}

export function LiveTimerCard({ target, setTarget }: Props) {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const { data: active } = useActiveTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const running = !!active;
  const liveElapsed = active ? Math.max(0, now - new Date(active.start_at).getTime()) : 0;

  const runningTarget: TrackerTarget | null = active
    ? {
        project_id: active.project_id,
        work_item_id: active.work_item_id,
        custom_task_text: active.custom_task_text,
      }
    : null;
  const displayTarget = runningTarget ?? target;
  const displayLabel = displayTarget && catalog ? labelForTarget(displayTarget, catalog) : null;

  async function onStart() {
    if (!target) {
      toast.error(t('tracker.pickTargetFirst'));
      return;
    }
    pushRecent(target);
    const notesVal = notes.trim() || null;
    setNotes('');
    setShowNotes(false);
    try {
      await start.mutateAsync({
        project_id: target.project_id,
        work_item_id: target.work_item_id,
        custom_task_text: target.custom_task_text,
        notes: notesVal,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onStop() {
    try {
      await stop.mutateAsync();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
      <div className="flex items-center gap-2">
        {running && (
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden />
        )}
        <div className="flex-1 min-w-0">
          {running && displayLabel ? (
            <div className="px-3 h-9 flex items-center rounded-md border border-transparent text-sm truncate text-neutral-900 dark:text-neutral-100">
              {displayLabel.join(' › ')}
            </div>
          ) : (
            <TaskTargetTrigger
              value={target}
              catalog={catalog}
              onClick={() => setPickerOpen(true)}
              onClear={() => setTarget(null)}
            />
          )}
        </div>

        <div className="font-mono text-lg tabular-nums px-2 text-neutral-900 dark:text-neutral-100 shrink-0">
          {formatHMS(liveElapsed)}
        </div>

        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          disabled={running}
          aria-label={t('tracker.addNote')}
          title={t('tracker.addNote')}
          className="h-9 w-9 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <StickyNote size={14} />
        </button>

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

      {showNotes && !running && (
        <Textarea
          placeholder={t('tracker.notesPlaceholder')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[60px]"
        />
      )}

      <TaskTargetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={target}
        onPick={(t) => setTarget(t)}
      />
    </div>
  );
}
