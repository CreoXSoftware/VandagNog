import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useActiveTimer, useDiscardTimer, useRestoreTimer } from '@/hooks/useTimeEntries';

// Deletes the running entry outright, with an undo in the toast in case the
// click was the mistake.
export function useDiscardRunningTimer() {
  const t = useT();
  const { data: active } = useActiveTimer();
  const discard = useDiscardTimer();
  const restore = useRestoreTimer();
  async function run() {
    if (!active) return;
    try {
      const entry = await discard.mutateAsync(active);
      toast.success(t('tracker.timerDiscarded'), {
        action: {
          label: t('tracker.undo'),
          onClick: () =>
            restore.mutate(entry, {
              onSuccess: () => toast.success(t('tracker.timerRestored')),
              onError: (err) => toast.error((err as Error).message),
            }),
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return { run, isPending: discard.isPending };
}
