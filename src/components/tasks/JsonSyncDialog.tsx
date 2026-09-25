import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { JsonSyncPanel } from './JsonSyncPanel';
import { useT } from '@/lib/i18n';
import type { TasksData } from '@/hooks/useTasksData';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: TasksData;
}

// Thin wrapper around JsonSyncPanel for the global Tasks page. The project Quick
// Add panel renders the same component inline, locked to its own project, so the
// two import paths cannot drift apart.
export function JsonSyncDialog({ open, onOpenChange, data }: Props) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('tasks.sync.title')} className="w-[720px]">
        <JsonSyncPanel data={data} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
