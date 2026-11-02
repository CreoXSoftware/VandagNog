import { useState } from 'react';
import { toast } from 'sonner';
import { Bug, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { useSubmitFeedback } from '@/hooks/useFeedback';
import { FEEDBACK_PRIORITIES, feedbackPriorityKey } from '@/lib/feedbackDisplay';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FeedbackPriority, FeedbackType } from '@/types/db';

const labelCls = 'text-xs font-medium text-neutral-600 dark:text-neutral-300';

// Send a feature request or bug report to the app admins (the app's
// developers). The database notes who sent it and from which org.
export function FeedbackDialog({
  open,
  onOpenChange,
  initialType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: FeedbackType;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('feedback.title')} className="w-[520px]">
        {/* Remounts on every open, so the form starts empty with the right type. */}
        {open && <FeedbackForm initialType={initialType} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackForm({ initialType, onDone }: { initialType: FeedbackType; onDone: () => void }) {
  const t = useT();
  const submit = useSubmitFeedback();

  const [type, setType] = useState<FeedbackType>(initialType);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [priority, setPriority] = useState<FeedbackPriority | ''>('');

  const isBug = type === 'bug';
  const canSend = !!title.trim() && !!description.trim() && !submit.isPending;

  async function send() {
    if (!canSend) return;
    try {
      await submit.mutateAsync({
        type,
        title: title.trim(),
        description: description.trim(),
        steps_to_reproduce: steps.trim() || null,
        priority: priority || null,
      });
      toast.success(t('feedback.submitted_toast'));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={t('feedback.title')} className="grid grid-cols-2 gap-2">
        <TypeOption
          active={type === 'bug'}
          onClick={() => setType('bug')}
          icon={<Bug size={16} />}
          label={t('feedback.bugLong')}
        />
        <TypeOption
          active={type === 'feature'}
          onClick={() => setType('feature')}
          icon={<Lightbulb size={16} />}
          label={t('feedback.featureLong')}
        />
      </div>

      <div>
        <label htmlFor="fb-title" className={labelCls}>{t('feedback.titleLabel')}</label>
        <Input
          id="fb-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isBug ? t('feedback.titleBugPh') : t('feedback.titleFeaturePh')}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="fb-desc" className={labelCls}>{t('feedback.descriptionLabel')}</label>
        <Textarea
          id="fb-desc"
          value={description}
          maxLength={10000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={isBug ? t('feedback.descBugPh') : t('feedback.descFeaturePh')}
          className="min-h-[100px]"
        />
      </div>

      {isBug && (
        <>
          <div>
            <label htmlFor="fb-steps" className={labelCls}>
              {t('feedback.steps')} <span className="font-normal text-neutral-400">({t('common.optional')})</span>
            </label>
            <Textarea
              id="fb-steps"
              value={steps}
              maxLength={10000}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={t('feedback.stepsPh')}
            />
          </div>
          <div>
            <label htmlFor="fb-priority" className={labelCls}>
              {t('feedback.priority')} <span className="font-normal text-neutral-400">({t('common.optional')})</span>
            </label>
            <Select
              id="fb-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as FeedbackPriority | '')}
              className="w-full"
            >
              <option value="">{t('feedback.priorityNone')}</option>
              {FEEDBACK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{t(feedbackPriorityKey[p])}</option>
              ))}
            </Select>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone}>{t('common.cancel')}</Button>
        <Button onClick={send} disabled={!canSend}>
          {submit.isPending ? t('common.sending') : t('feedback.send')}
        </Button>
      </div>
    </div>
  );
}

function TypeOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 h-10 rounded-md border text-sm font-medium transition-colors',
        active
          ? 'border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
          : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
