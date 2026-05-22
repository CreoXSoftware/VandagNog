import { useEffect, useState } from 'react';
import { Play, Square, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
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
  // `now` triggers re-render every second so this value updates live.
  const liveElapsed = active ? Math.max(0, now - new Date(active.start_at).getTime()) : 0;

  const liveLabel = active && catalog ? labelForTarget(
    {
      project_id: active.project_id,
      work_item_id: active.work_item_id,
      custom_task_text: active.custom_task_text,
    },
    catalog,
  ) : null;

  async function onStart() {
    if (!target) {
      toast.error(t('tracker.pickTargetFirst'));
      return;
    }
    try {
      await start.mutateAsync({
        project_id: target.project_id,
        work_item_id: target.work_item_id,
        custom_task_text: target.custom_task_text,
        notes: notes.trim() || null,
      });
      pushRecent(target);
      toast.success(t('tracker.timerStarted'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onStop() {
    try {
      await stop.mutateAsync();
      toast.success(t('tracker.timerStopped'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
      {running && active ? (
        <RunningView
          elapsedMs={liveElapsed}
          label={liveLabel}
          onStop={onStop}
          pending={stop.isPending}
        />
      ) : (
        <>
          <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t('tracker.liveTimer')}
          </div>

          <TaskTargetTrigger
            value={target}
            catalog={catalog}
            onClick={() => setPickerOpen(true)}
            onClear={() => setTarget(null)}
          />

          {showNotes ? (
            <Textarea
              placeholder={t('tracker.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[60px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <StickyNote size={12} /> {t('tracker.addNote')}
            </button>
          )}

          <div className="flex justify-end">
            <Button onClick={onStart} disabled={!target || start.isPending}>
              <Play size={14} /> {t('tracker.start')}
            </Button>
          </div>
        </>
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

function RunningView({
  elapsedMs,
  label,
  onStop,
  pending,
}: {
  elapsedMs: number;
  label: string[] | null;
  onStop: () => void;
  pending: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center justify-center w-3 h-3 rounded-full bg-red-500 animate-pulse" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">
          {t('tracker.running')}
        </div>
        <div className="font-mono text-2xl tabular-nums text-neutral-900 dark:text-neutral-100">
          {formatHMS(elapsedMs)}
        </div>
        {label && (
          <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 truncate">
            {label.join(' › ')}
          </div>
        )}
      </div>
      <Button variant="danger" onClick={onStop} disabled={pending}>
        <Square size={14} /> {t('tracker.stop')}
      </Button>
    </div>
  );
}
