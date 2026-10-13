import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useCreateManualEntry, pushRecent } from '@/hooks/useTimeEntries';
import { useTrackerCatalog } from '@/hooks/useTrackerCatalog';
import { TaskTargetPicker, TaskTargetTrigger } from './TaskTargetPicker';
import { combineDateTime, isoDate, isoTime, formatHM, formatHMS } from '@/lib/timeFormat';
import type { TrackerTarget } from '@/types/db';

interface Props {
  target: TrackerTarget | null;
  setTarget: (t: TrackerTarget | null) => void;
  /** Rendered as the card's first row (the Live / Manual switch). */
  header?: React.ReactNode;
}

export function ManualEntryForm({ target, setTarget, header }: Props) {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const create = useCreateManualEntry();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [date, setDate] = useState<string>(() => isoDate(new Date()));
  const [start, setStart] = useState<string>(() => isoTime(new Date(Date.now() - 60 * 60 * 1000)));
  const [end, setEnd] = useState<string>(() => isoTime(new Date()));
  const [notes, setNotes] = useState('');

  const startDt = combineDateTime(date, start);
  const endDt = combineDateTime(date, end);
  const valid = endDt > startDt;
  const previewMs = valid ? endDt.getTime() - startDt.getTime() : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) {
      toast.error(t('tracker.pickTargetFirst'));
      return;
    }
    if (!valid) {
      toast.error(t('tracker.endBeforeStart'));
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
      {/* Same order as the live timer: note · target · duration · action. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Input
          placeholder={t('tracker.notePlaceholder')}
          aria-label={t('tracker.notesLabel')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="sm:flex-1 min-w-0"
        />

        <div className="sm:w-[42%] min-w-0">
          <TaskTargetTrigger
            value={target}
            catalog={catalog}
            onClick={() => setPickerOpen(true)}
            onClear={() => setTarget(null)}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <div
            className={cn(
              'font-mono text-lg tabular-nums px-1',
              valid ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500',
            )}
            title={valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : t('tracker.endBeforeStart')}
          >
            {formatHMS(previewMs)}
          </div>
          <button
            type="submit"
            disabled={!target || !valid || create.isPending}
            aria-label={t('tracker.addEntry')}
            title={valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : t('tracker.endBeforeStart')}
            className="h-9 w-9 rounded-md flex items-center justify-center transition-colors shrink-0 bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Date and times. Widths leave room for a 12-hour "PM" beside the
          browser's clock icon. */}
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
        <span className="text-neutral-400 dark:text-neutral-500" aria-hidden>
          –
        </span>
        <Input
          type="time"
          aria-label={t('tracker.endTime')}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
          className="w-[8.75rem] shrink-0"
        />
        <span
          className={cn(
            'text-[11px]',
            valid ? 'text-neutral-500 dark:text-neutral-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : t('tracker.endBeforeStart')}
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
