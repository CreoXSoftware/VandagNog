import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useCreateInvite, useInvites, useRemoveMember, useRevokeInvite, useUpdateMemberRole } from '@/hooks/useMembers';
import type { ProjectMember, ProjectRole } from '@/types/db';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { env } from '@/lib/env';
import { Avatar } from '@/components/ui/Avatar';
import { displayName } from '@/lib/userDisplay';
import { useT, type TKey } from '@/lib/i18n';

interface Props {
  projectId: string;
  members: ProjectMember[];
  myRole: ProjectRole | null;
}

const roleLabelKey: Record<ProjectRole, TKey> = {
  owner: 'members.roleOwner',
  editor: 'members.roleEditor',
  viewer: 'members.roleViewer',
};

export function MembersPanel({ projectId, members, myRole }: Props) {
  const { data: invites = [] } = useInvites(projectId);
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const revoke = useRevokeInvite();
  const t = useT();

  const canManage = myRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('members.title')}</h2>
        {canManage && <InviteDialog projectId={projectId} />}
      </div>

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
        <div className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
          {t('members.active', { count: members.length })}
        </div>
        {members.map((m) => (
          <div key={m.user_id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
            <Avatar user={m} size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{displayName(m)}</div>
              {m.email && displayName(m) !== m.email && (
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{m.email}</div>
              )}
            </div>
            {canManage ? (
              <Select
                value={m.role}
                disabled={m.role === 'owner' && ownerCount === 1}
                onChange={(e) =>
                  updateRole.mutate(
                    { project_id: projectId, user_id: m.user_id, role: e.target.value as ProjectRole },
                    { onError: (err) => toast.error((err as Error).message) },
                  )
                }
                className="h-7 text-xs"
              >
                <option value="owner">{t('members.roleOwner')}</option>
                <option value="editor">{t('members.roleEditor')}</option>
                <option value="viewer">{t('members.roleViewer')}</option>
              </Select>
            ) : (
              <Badge kind={m.role}>{t(roleLabelKey[m.role])}</Badge>
            )}
            {canManage && (m.role !== 'owner' || ownerCount > 1) && (
              <button
                onClick={() => {
                  if (confirm(t('members.removeConfirm')))
                    removeMember.mutate(
                      { project_id: projectId, user_id: m.user_id },
                      { onError: (err) => toast.error((err as Error).message) },
                    );
                }}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && invites.length > 0 && (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
          <div className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
            {t('members.pending', { count: invites.length })}
          </div>
          {invites.map((inv) => (
            <div key={inv.id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{inv.email}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t('common.role')}: {t(roleLabelKey[inv.role])} · {t('members.expires', { date: formatDate(inv.expires_at) })}
                </div>
                <div className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5 font-mono break-all">
                  {env.APP_URL}/invite/{inv.token}
                </div>
              </div>
              <button
                onClick={() => revoke.mutate({ id: inv.id, project_id: projectId })}
                className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                title={t('common.revoke')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InviteDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const create = useCreateInvite();
  const t = useT();

  async function submit() {
    if (!email.trim()) return;
    try {
      const res = await create.mutateAsync({ project_id: projectId, email: email.trim(), role });
      setEmail('');
      setOpen(false);
      const link = `${env.APP_URL}/invite/${res.token}`;
      await navigator.clipboard.writeText(link).catch(() => undefined);
      toast.success(t('members.inviteCreated_toast'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus size={14} /> {t('members.invite')}</Button>
      </DialogTrigger>
      <DialogContent title={t('members.inviteMember')}>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.email')}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('members.invitePlaceholder')}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.role')}</label>
            <Select className="w-full" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              <option value="editor">{t('members.roleEditorDesc')}</option>
              <option value="viewer">{t('members.roleViewerDesc')}</option>
              <option value="owner">{t('members.roleOwnerDesc')}</option>
            </Select>
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {t('members.inviteHelp')}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={create.isPending || !email.trim()}>
              {create.isPending ? '…' : t('members.createInvite')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
