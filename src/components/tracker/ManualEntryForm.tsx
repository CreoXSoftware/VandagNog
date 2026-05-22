import { useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
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
    <form onSubmit={onSubmit} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {t('tracker.manualEntry')}
      </div>

      <TaskTargetTrigger
        value={target}
        catalog={catalog}
        onClick={() => setPickerOpen(true)}
        onClear={() => setTarget(null)}
      />

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.date')}</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.startTime')}</label>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.endTime')}</label>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>

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

      <div className="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {valid ? t('tracker.willLog', { duration: formatHM(previewMs) }) : t('tracker.endBeforeStart')}
        </div>
        <Button type="submit" disabled={!target || !valid || create.isPending}>
          <Plus size={14} /> {t('tracker.addEntry')}
        </Button>
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
