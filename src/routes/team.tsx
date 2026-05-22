import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Copy, RefreshCw, Trash2, LogOut, ArrowLeft, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import {
  useAddTeamToProject,
  useDeleteTeam,
  useMyTeams,
  useRegenerateInviteCode,
  useRemoveTeamMember,
  useTeam,
  useTeamMembers,
  useUpdateTeam,
  useUpdateTeamMemberRole,
} from '@/hooks/useTeams';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';
import { displayName } from '@/lib/userDisplay';
import { useT } from '@/lib/i18n';
import type { ProjectRole, TeamRole } from '@/types/db';
import { env } from '@/lib/env';

export function TeamPage() {
  const { teamId } = useParams({ from: '/_app/teams/$teamId' });
  const { data: team } = useTeam(teamId);
  const { data: members = [] } = useTeamMembers(teamId);
  const { data: myTeams = [] } = useMyTeams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  const myTeamRow = myTeams.find((tm) => tm.id === teamId);
  const myRole: TeamRole | null = myTeamRow?.my_role ?? null;
  const canManage = myRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const regen = useRegenerateInviteCode();
  const update = useUpdateTeam();
  const remove = useRemoveTeamMember();
  const updateRole = useUpdateTeamMemberRole();
  const del = useDeleteTeam();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  function startEdit() {
    if (!team) return;
    setName(team.name);
    setDesc(team.description ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!team || !name.trim()) return;
    try {
      await update.mutateAsync({ id: team.id, name: name.trim(), description: desc.trim() || null });
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copyCode() {
    if (!team) return;
    await navigator.clipboard.writeText(team.invite_code).catch(() => undefined);
    toast.success(t('teams.codeCopied_toast'));
  }

  async function copyLink() {
    if (!team) return;
    const link = `${env.APP_URL}/teams?join=${team.invite_code}`;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    toast.success(t('teams.linkCopied_toast'));
  }

  async function doRegen() {
    if (!team) return;
    if (!confirm(t('teams.regenerateConfirm'))) return;
    try {
      await regen.mutateAsync(team.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function leaveOrDelete() {
    if (!team || !user) return;
    if (canManage) {
      if (!confirm(t('teams.deleteConfirm'))) return;
      try {
        await del.mutateAsync(team.id);
        toast.success(t('teams.deleted_toast'));
        navigate({ to: '/teams' });
      } catch (e) {
        toast.error((e as Error).message);
      }
    } else {
      if (!confirm(t('teams.leaveConfirm'))) return;
      try {
        await remove.mutateAsync({ team_id: team.id, user_id: user.id });
        navigate({ to: '/teams' });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }

  if (!team) {
    return <div className="p-6 text-sm text-neutral-500">{t('common.loading')}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-2">
        <Link to="/teams" className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-xl font-semibold flex-1">{team.name}</h1>
        {canManage && !editing && (
          <Button variant="outline" size="sm" onClick={startEdit}>{t('teams.editTeam')}</Button>
        )}
        <Button variant="outline" size="sm" onClick={leaveOrDelete}>
          {canManage ? <><Trash2 size={14} /> {t('common.delete')}</> : <><LogOut size={14} /> {t('teams.leave')}</>}
        </Button>
      </div>

      {editing && (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('teams.teamName')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('teams.descriptionOptional')}</label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={saveEdit} disabled={update.isPending || !name.trim()}>
              {update.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      )}

      {!editing && team.description && (
        <div className="text-sm text-neutral-600 dark:text-neutral-400">{team.description}</div>
      )}

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4">
        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">{t('teams.inviteCode')}</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-sm px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 break-all">
            {team.invite_code}
          </code>
          <Button variant="outline" size="sm" onClick={copyCode} title={t('teams.copyCode')}><Copy size={14} /></Button>
          <Button variant="outline" size="sm" onClick={copyLink} title={t('teams.copyLink')}>{t('teams.copyLink')}</Button>
          {canManage && (
            <Button variant="outline" size="sm" onClick={doRegen} disabled={regen.isPending} title={t('teams.regenerateCode')}>
              <RefreshCw size={14} />
            </Button>
          )}
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2">{t('teams.inviteCodeIs')}</div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('teams.members', { count: members.length })}</h2>
        <AddTeamToProjectDialog teamId={team.id} />
      </div>

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
        {members.map((m) => (
          <div key={m.user_id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
            <Avatar user={m} size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{displayName(m)}</div>
              {m.email && displayName(m) !== m.email && (
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{m.email}</div>
              )}
            </div>
            {canManage && m.user_id !== user?.id ? (
              <Select
                value={m.role}
                disabled={m.role === 'owner' && ownerCount === 1}
                onChange={(e) =>
                  updateRole.mutate(
                    { team_id: team.id, user_id: m.user_id, role: e.target.value as TeamRole },
                    { onError: (err) => toast.error((err as Error).message) },
                  )
                }
                className="h-7 text-xs"
              >
                <option value="owner">{t('teams.roleOwner')}</option>
                <option value="member">{t('teams.roleMember')}</option>
              </Select>
            ) : (
              <Badge kind={m.role === 'owner' ? 'owner' : 'viewer'}>
                {t(m.role === 'owner' ? 'teams.roleOwner' : 'teams.roleMember')}
              </Badge>
            )}
            {canManage && m.user_id !== user?.id && (m.role !== 'owner' || ownerCount > 1) && (
              <button
                onClick={() => {
                  if (confirm(t('members.removeConfirm')))
                    remove.mutate(
                      { team_id: team.id, user_id: m.user_id },
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
    </div>
  );
}

function AddTeamToProjectDialog({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const { data: projects = [] } = useProjects();
  const add = useAddTeamToProject();
  const t = useT();

  async function submit() {
    if (!projectId) return;
    try {
      const n = await add.mutateAsync({ project_id: projectId, team_id: teamId, role });
      setOpen(false);
      toast.success(t('projectAdd.addedCount_toast', { count: n }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><FolderPlus size={14} /> {t('teams.addToProject')}</Button>
      </DialogTrigger>
      <DialogContent title={t('teams.addToProject')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('projects.title')}</label>
            <Select className="w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.role')}</label>
            <Select className="w-full" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              <option value="editor">{t('members.roleEditor')}</option>
              <option value="viewer">{t('members.roleViewer')}</option>
              <option value="owner">{t('members.roleOwner')}</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={add.isPending || !projectId}>
              {add.isPending ? '…' : t('projectAdd.add')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
