import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';
import { useDeleteTimeEntry, useUpdateTimeEntry } from '@/hooks/useTimeEntries';
import { useTrackerCatalog } from '@/hooks/useTrackerCatalog';
import { TaskTargetPicker, TaskTargetTrigger } from './TaskTargetPicker';
import { combineDateTime, isoDate, isoTime } from '@/lib/timeFormat';
import type { TimeEntry, TrackerTarget } from '@/types/db';

interface Props {
  entry: TimeEntry;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SessionEditDialog({ entry, open, onOpenChange }: Props) {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const update = useUpdateTimeEntry();
  const del = useDeleteTimeEntry();

  const [target, setTarget] = useState<TrackerTarget>({
    project_id: entry.project_id,
    work_item_id: entry.work_item_id,
    custom_task_text: entry.custom_task_text,
  });
  const startD = new Date(entry.start_at);
  const endD = entry.end_at ? new Date(entry.end_at) : new Date();
  const [date, setDate] = useState<string>(isoDate(startD));
  const [start, setStart] = useState<string>(isoTime(startD));
  const [end, setEnd] = useState<string>(isoTime(endD));
  const [notes, setNotes] = useState<string>(entry.notes ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  const startDt = combineDateTime(date, start);
  const endDt = combineDateTime(date, end);
  const valid = endDt > startDt;

  async function onSave() {
    if (!valid) {
      toast.error(t('tracker.endBeforeStart'));
      return;
    }
    try {
      await update.mutateAsync({
        id: entry.id,
        patch: {
          project_id: target.project_id,
          work_item_id: target.work_item_id,
          custom_task_text: target.custom_task_text,
          notes: notes.trim() || null,
          start_at: startDt.toISOString(),
          end_at: endDt.toISOString(),
        },
      });
      toast.success(t('tracker.entrySaved'));
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function onDelete() {
    if (!confirm(t('tracker.deleteConfirm'))) return;
    try {
      await del.mutateAsync(entry.id);
      toast.success(t('tracker.entryDeleted'));
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('tracker.editEntry')}>
        <div className="space-y-3">
          <TaskTargetTrigger
            value={target}
            catalog={catalog}
            onClick={() => setPickerOpen(true)}
          />

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.date')}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.startTime')}</label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.endTime')}</label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.notesLabel')}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px]" />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <Button variant="ghost" onClick={onDelete} disabled={del.isPending}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button onClick={onSave} disabled={!valid || update.isPending}>
                {update.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </div>

        <TaskTargetPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          value={target}
          onPick={(t) => setTarget(t)}
        />
      </DialogContent>
    </Dialog>
  );
}
