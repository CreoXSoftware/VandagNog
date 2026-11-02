import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Bug, ChevronDown, ChevronRight, Lightbulb, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import {
  FeedbackForbiddenError,
  useFeedback,
  useIsAppAdmin,
  useSetFeedbackStatus,
} from '@/hooks/useFeedback';
import { useAuth } from '@/hooks/useAuth';
import {
  FEEDBACK_STATUSES,
  OPEN_FEEDBACK_STATUSES,
  feedbackPriorityClass,
  feedbackPriorityKey,
  feedbackStatusClass,
  feedbackStatusKey,
  feedbackTypeClass,
  feedbackTypeKey,
} from '@/lib/feedbackDisplay';
import { useT } from '@/lib/i18n';
import { cn, formatDate } from '@/lib/utils';
import type { FeatureRequest, FeedbackStatus, FeedbackType } from '@/types/db';

type StatusFilter = FeedbackStatus | 'open' | '';
// '' = every org, NO_ORG = sent from a Personal space.
const NO_ORG = '__none__';

// Feature requests and bug reports. They go to the app admins (the app's
// developers), who see everything and set the status; everyone else sees what
// they sent and where it stands.
export function FeedbackPage() {
  const t = useT();
  const { user } = useAuth();
  const { request: focusId } = useSearch({ from: '/_app/feedback' });
  const { data: isAdmin = false } = useIsAppAdmin();
  const { data: requests = [], isLoading } = useFeedback();

  const [dialogType, setDialogType] = useState<FeedbackType | null>(null);
  const [type, setType] = useState<FeedbackType | ''>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [org, setOrg] = useState('');

  // Orgs the requests came from, for the app admin's filter.
  const orgs = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of requests) if (r.org_id && r.org_name) byId.set(r.org_id, r.org_name);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [requests]);

  const shown = useMemo(
    () =>
      requests.filter(
        (r) =>
          (!type || r.type === type) &&
          (!status ||
            (status === 'open' ? OPEN_FEEDBACK_STATUSES.includes(r.status) : r.status === status)) &&
          (!org || (org === NO_ORG ? !r.org_id : r.org_id === org)),
      ),
    [requests, type, status, org],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h1 className="text-xl font-semibold">{t('feedback.title')}</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDialogType('bug')}>
              <Bug size={14} /> {t('feedback.reportBug')}
            </Button>
            <Button onClick={() => setDialogType('feature')}>
              <Lightbulb size={14} /> {t('feedback.requestFeature')}
            </Button>
          </div>
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
          {isAdmin ? t('feedback.adminHint') : t('feedback.userHint')}
        </div>

        {requests.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Select value={type} onChange={(e) => setType(e.target.value as FeedbackType | '')} aria-label={t('feedback.type')}>
              <option value="">{t('feedback.allTypes')}</option>
              <option value="feature">{t('feedback.typeFeature')}</option>
              <option value="bug">{t('feedback.typeBug')}</option>
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              aria-label={t('feedback.status')}
            >
              <option value="">{t('feedback.allStatuses')}</option>
              <option value="open">{t('feedback.statusOpen')}</option>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>{t(feedbackStatusKey[s])}</option>
              ))}
            </Select>
            {isAdmin && (
              <Select value={org} onChange={(e) => setOrg(e.target.value)} aria-label={t('feedback.org')}>
                <option value="">{t('feedback.allOrgs')}</option>
                {orgs.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
                <option value={NO_ORG}>{t('feedback.noOrg')}</option>
              </Select>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
        ) : requests.length === 0 ? (
          <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
            <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('feedback.noneYet')}</div>
            <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('feedback.noneHint')}</div>
          </div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('feedback.noMatch')}</div>
        ) : (
          <div className="space-y-2">
            {shown.map((r) => (
              <FeedbackRow
                key={r.id}
                request={r}
                canTriage={isAdmin}
                focused={r.id === focusId}
                sender={
                  r.submitted_by === user?.id
                    ? t('feedback.sentOn', { date: formatDate(r.created_at) })
                    : t('feedback.sentBy', {
                        name: r.sender_name ?? r.sender_email ?? t('feedback.deletedUser'),
                        date: formatDate(r.created_at),
                      })
                }
              />
            ))}
          </div>
        )}
      </div>

      <FeedbackDialog
        open={dialogType !== null}
        onOpenChange={(v) => { if (!v) setDialogType(null); }}
        initialType={dialogType ?? 'feature'}
      />
    </div>
  );
}

function FeedbackRow({
  request: r,
  canTriage,
  focused,
  sender,
}: {
  request: FeatureRequest;
  canTriage: boolean;
  /** Opened from a notification: expand and scroll to it. */
  focused: boolean;
  sender: string;
}) {
  const t = useT();
  const setStatus = useSetFeedbackStatus();
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLDivElement>(null);

  // Another notification for a row that is already on screen: open it too.
  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    if (focused) setOpen(true);
  }

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  async function changeStatus(next: FeedbackStatus) {
    if (next === r.status) return;
    try {
      await setStatus.mutateAsync({ id: r.id, status: next });
      toast.success(t('feedback.statusUpdated_toast'));
    } catch (err) {
      toast.error(err instanceof FeedbackForbiddenError ? t('feedback.statusForbidden') : (err as Error).message);
    }
  }

  return (
    <div
      ref={ref}
      className={cn(
        'border rounded-lg bg-white dark:bg-neutral-900',
        focused ? 'border-sky-400 dark:border-sky-600' : 'border-neutral-200 dark:border-neutral-800',
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-start gap-2 text-left"
        >
          <span className="mt-0.5 text-neutral-400">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 min-w-0">
              <Badge className={feedbackTypeClass[r.type]}>{t(feedbackTypeKey[r.type])}</Badge>
              <span className="font-medium text-sm truncate">{r.title}</span>
            </span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {sender}
              {canTriage && r.org_name && <> · {r.org_name}</>}
              {r.priority && (
                <>
                  {' · '}
                  <span className={feedbackPriorityClass[r.priority]}>
                    {t('feedback.priority')}: {t(feedbackPriorityKey[r.priority])}
                  </span>
                </>
              )}
            </span>
          </span>
        </button>

        {canTriage ? (
          <Select
            value={r.status}
            onChange={(e) => void changeStatus(e.target.value as FeedbackStatus)}
            disabled={setStatus.isPending}
            aria-label={t('feedback.status')}
            className={cn('h-7 text-xs font-medium border-transparent dark:border-transparent', feedbackStatusClass[r.status])}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>{t(feedbackStatusKey[s])}</option>
            ))}
          </Select>
        ) : (
          <Badge className={feedbackStatusClass[r.status]}>{t(feedbackStatusKey[r.status])}</Badge>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 pl-9 space-y-3 text-sm text-neutral-700 dark:text-neutral-200">
          <p className="whitespace-pre-wrap break-words">{r.description}</p>
          {r.steps_to_reproduce && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1">
                {t('feedback.steps')}
              </div>
              <p className="whitespace-pre-wrap break-words">{r.steps_to_reproduce}</p>
            </div>
          )}
          {canTriage && r.sender_email && (
            <a
              href={`mailto:${r.sender_email}?subject=${encodeURIComponent(`Re: ${r.title}`)}`}
              className="inline-flex items-center gap-1.5 text-xs text-sky-700 hover:underline dark:text-sky-400"
            >
              <Mail size={12} /> {t('feedback.replyByEmail', { email: r.sender_email })}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
