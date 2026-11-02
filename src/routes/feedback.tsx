import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bug, ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import {
  FeedbackForbiddenError,
  useMyFeedback,
  useOrgFeedback,
  useSetFeedbackStatus,
} from '@/hooks/useFeedback';
import { orgRoleAtLeast, useOrgMembers } from '@/hooks/useOrgs';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useOrgName } from '@/lib/orgDisplay';
import { displayName } from '@/lib/userDisplay';
import {
  FEEDBACK_STATUSES,
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

type Scope = 'all' | 'mine';

// Feature requests and bug reports for the current organization. Everyone sees
// what they sent; owners/admins see everything sent to the org and set the
// status. The Personal org can't receive feedback, so there the page lists
// what the user sent to any org.
export function FeedbackPage() {
  const t = useT();
  const { user } = useAuth();
  const { org, orgs } = useCurrentOrg();
  const orgName = useOrgName();
  const isAdmin = !org.is_personal && orgRoleAtLeast(org.my_role, 'admin');

  const orgList = useOrgFeedback(org.id, !org.is_personal);
  const mineList = useMyFeedback(user?.id, org.is_personal);
  const { data: requests = [], isLoading } = org.is_personal ? mineList : orgList;
  // Names of the people who sent them; only admins see other people's requests.
  const { data: members = [] } = useOrgMembers(isAdmin ? org.id : undefined);

  const [dialogType, setDialogType] = useState<FeedbackType | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [status, setStatus] = useState<FeedbackStatus | ''>('');

  const shown = useMemo(
    () =>
      requests.filter(
        (r) => (!status || r.status === status) && (scope === 'all' || r.submitted_by === user?.id),
      ),
    [requests, status, scope, user?.id],
  );

  const nameOf = useMemo(() => {
    const byId = new Map(members.map((m) => [m.user_id, displayName(m)]));
    return (id: string | null) => (id ? byId.get(id) : undefined) ?? t('feedback.formerMember');
  }, [members, t]);

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const hint = org.is_personal
    ? t('feedback.personalHint')
    : isAdmin
      ? t('feedback.adminHint', { org: orgName(org) })
      : t('feedback.orgHint', { org: orgName(org) });

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
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">{hint}</div>

        {requests.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            {isAdmin && (
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label={t('feedback.showMine')}>
                <option value="all">{t('feedback.showAll')}</option>
                <option value="mine">{t('feedback.showMine')}</option>
              </Select>
            )}
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')}
              aria-label={t('feedback.status')}
            >
              <option value="">{t('feedback.allStatuses')}</option>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>{t(feedbackStatusKey[s])}</option>
              ))}
            </Select>
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
                sender={
                  r.submitted_by === user?.id
                    ? t('feedback.sentOn', { date: formatDate(r.created_at) })
                    : t('feedback.sentBy', { name: nameOf(r.submitted_by), date: formatDate(r.created_at) })
                }
                orgLabel={org.is_personal ? orgById.get(r.org_id)?.name : undefined}
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
  sender,
  orgLabel,
}: {
  request: FeatureRequest;
  canTriage: boolean;
  sender: string;
  orgLabel?: string;
}) {
  const t = useT();
  const setStatus = useSetFeedbackStatus();
  const [open, setOpen] = useState(false);

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
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
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
              {orgLabel && <> · {orgLabel}</>}
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
        </div>
      )}
    </div>
  );
}
