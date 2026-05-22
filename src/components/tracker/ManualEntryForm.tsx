import { useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Input, Textarea } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';
import { useCreateManualEntry, pushRecent } from '@/hooks/useTimeEntries';
import { useTrackerCatalog } from '@/hooks/useTrackerCatalog';
import { TaskTargetPicker, TaskTargetTrigger } from './TaskTargetPicker';
import { combineDateTime, isoDate, isoTime, formatHM } from '@/lib/timeFormat';
import type { TrackerTarget } from '@/types/db';

interface Props {
  target: TrackerTarget | null;
  setTarget: (t: TrackerTarget | null) => void;
}

export function ManualEntryForm({ target, setTarget }: Props) {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const create = useCreateManualEntry();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [date, setDate] = useState<string>(() => isoDate(new Date()));
  const [start, setStart] = useState<string>(() => isoTime(new Date(Date.now() - 60 * 60 * 1000)));
  const [end, setEnd] = useState<string>(() => isoTime(new Date()));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

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
      setShowNotes(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <TaskTargetTrigger
            value={target}
            catalog={catalog}
            onClick={() => setPickerOpen(true)}
            onClear={() => setTarget(null)}
          />
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="w-[140px] shrink-0"
        />
        <Input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
          className="w-[110px] shrink-0"
        />
        <Input
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          required
          className="w-[110px] shrink-0"
        />
        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          aria-label={t('tracker.addNote')}
          title={t('tracker.addNote')}
          className="h-9 w-9 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
        >
          <StickyNote size={14} />
        </button>
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

      {showNotes && (
        <Textarea
          placeholder={t('tracker.notesPlaceholder')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[60px]"
        />
      )}

      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
        {valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : t('tracker.endBeforeStart')}
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
