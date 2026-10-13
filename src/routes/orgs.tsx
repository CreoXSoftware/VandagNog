import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Check, LogIn, Network, Plus, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { orgRoleKey, useOrgName } from '@/lib/orgDisplay';
import { useCreateOrg, useJoinOrg } from '@/hooks/useOrgs';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function OrgsListPage() {
  const t = useT();
  const orgName = useOrgName();
  const { org: current, orgs, setOrgId } = useCurrentOrg();
  const search = useSearch({ from: '/_app/orgs' });
  const navigate = useNavigate();
  const join = useJoinOrg();
  const handled = useRef<string | null>(null);

  // /orgs?join=CODE from a shared invite link.
  useEffect(() => {
    const code = search.join?.trim();
    if (!code || handled.current === code) return;
    handled.current = code;
    join
      .mutateAsync(code)
      .then((o) => {
        toast.success(t('orgs.joined_toast', { name: o.name }));
        setOrgId(o.id);
        navigate({ to: '/orgs/$orgId', params: { orgId: o.id } });
      })
      .catch((e) => toast.error((e as Error).message));
  }, [search.join, join, navigate, setOrgId, t]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">{t('orgs.title')}</h1>
          <div className="flex gap-2">
            <JoinOrgDialog />
            <NewOrgDialog />
          </div>
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-6">{t('orgs.intro')}</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {orgs.map((o) => {
            const isCurrent = o.id === current.id;
            return (
              <div
                key={o.id}
                className={cn(
                  'relative border rounded-lg p-4 bg-white dark:bg-neutral-900 transition-colors',
                  isCurrent
                    ? 'border-neutral-500 dark:border-neutral-400'
                    : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600',
                )}
              >
                <div className="flex items-center gap-2">
                  {o.is_personal ? (
                    <User size={16} className="text-neutral-500" />
                  ) : (
                    <Network size={16} className="text-neutral-500" />
                  )}
                  {/* Stretched link: the card opens the org; the switch button sits above it. */}
                  <Link
                    to="/orgs/$orgId"
                    params={{ orgId: o.id }}
                    className="font-medium flex-1 truncate after:absolute after:inset-0"
                  >
                    {orgName(o)}
                  </Link>
                  {!o.is_personal && <Badge kind={o.my_role}>{t(orgRoleKey[o.my_role])}</Badge>}
                </div>
                {o.description && (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{o.description}</div>
                )}
                <div className="flex items-center justify-between gap-2 mt-3">
                  <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    {o.is_personal
                      ? t('orgs.personalCounts', { projects: o.project_count, guests: o.guest_count })
                      : t('orgs.counts', { members: o.member_count, guests: o.guest_count, projects: o.project_count })}
                  </div>
                  {isCurrent ? (
                    <span className="relative z-10 inline-flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                      <Check size={12} /> {t('orgs.current')}
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" className="relative z-10" onClick={() => setOrgId(o.id)}>
                      {t('orgs.switchTo')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NewOrgDialog() {
  const t = useT();
  const { setOrgId } = useCurrentOrg();
  const navigate = useNavigate();
  const create = useCreateOrg();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  async function submit() {
    if (!name.trim()) return;
    try {
      const o = await create.mutateAsync({ name: name.trim(), description: desc.trim() || null });
      setName('');
      setDesc('');
      setOpen(false);
      toast.success(t('orgs.created_toast'));
      setOrgId(o.id);
      navigate({ to: '/orgs/$orgId', params: { orgId: o.id } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus size={14} /> {t('orgs.newOrg')}</Button>
      </DialogTrigger>
      <DialogContent title={t('orgs.newOrg')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('orgs.orgName')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('orgs.descriptionOptional')}</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('orgs.newOrgHelp')}</div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={create.isPending || !name.trim()}>
              {create.isPending ? t('common.creating') : t('common.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JoinOrgDialog() {
  const t = useT();
  const { setOrgId } = useCurrentOrg();
  const navigate = useNavigate();
  const join = useJoinOrg();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  async function submit() {
    const c = code.trim();
    if (!c) return;
    try {
      const o = await join.mutateAsync(c);
      setCode('');
      setOpen(false);
      toast.success(t('orgs.joined_toast', { name: o.name }));
      setOrgId(o.id);
      navigate({ to: '/orgs/$orgId', params: { orgId: o.id } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><LogIn size={14} /> {t('orgs.join')}</Button>
      </DialogTrigger>
      <DialogContent title={t('orgs.joinByCode')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('orgs.inviteCode')}</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={t('orgs.enterCode')}
              autoFocus
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={join.isPending || !code.trim()}>
              {join.isPending ? '…' : t('orgs.join')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
