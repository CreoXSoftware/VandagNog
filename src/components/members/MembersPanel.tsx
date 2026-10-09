import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Trash2, Unlink, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import {
  useCreateInvite,
  useInvites,
  useProjectTeams,
  useRemoveMember,
  useRevokeInvite,
  useUnlinkTeam,
  useUpdateMemberRole,
  useUpdateProjectTeamRole,
} from '@/hooks/useMembers';
import { useAddTeamToProject, useAddUserToProject, useMyTeams, useTeamMembers } from '@/hooks/useTeams';
import type { ProjectMember, ProjectRole, ProjectTeam } from '@/types/db';
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

const roleRank: Record<ProjectRole, number> = { owner: 0, editor: 1, viewer: 2 };

// Own row's role, or null when the person is only in via a team. The fallback
// member query (no RPC) has no direct_role at all; every row there is direct.
function directRoleOf(m: ProjectMember): ProjectRole | null {
  return m.direct_role === undefined ? m.role : m.direct_role;
}

// Mirrors project_role() on the server: the highest of the person's own role
// and the roles of the linked teams they are in. Used to check that a change
// would not leave the project without an owner before sending it.
function countOwners(
  members: ProjectMember[],
  teamRoles: Map<string, ProjectRole>,
  directChange?: { user_id: string; role: ProjectRole | null },
): number {
  let n = 0;
  for (const m of members) {
    let r = directChange?.user_id === m.user_id ? directChange.role : directRoleOf(m);
    for (const id of m.team_ids ?? []) {
      const tr = teamRoles.get(id);
      if (tr && (!r || roleRank[tr] < roleRank[r])) r = tr;
    }
    if (r === 'owner') n += 1;
  }
  return n;
}

export function MembersPanel({ projectId, members, myRole }: Props) {
  const { data: invites = [] } = useInvites(projectId);
  const { data: teams = [] } = useProjectTeams(projectId);
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const updateTeamRole = useUpdateProjectTeamRole();
  const unlinkTeam = useUnlinkTeam();
  const revoke = useRevokeInvite();
  const t = useT();

  const canManage = myRole === 'owner';
  const teamRoles = useMemo(() => new Map(teams.map((tm) => [tm.team_id, tm.role])), [teams]);
  const teamNames = useMemo(() => new Map(teams.map((tm) => [tm.team_id, tm.name])), [teams]);
  const teamsOf = (m: ProjectMember) =>
    (m.team_ids ?? []).map((id) => teamNames.get(id)).filter(Boolean).join(', ');

  const onError = (err: unknown) => toast.error((err as Error).message);
  const lastOwner = () => {
    toast.error(t('members.lastOwner'));
  };

  function setMemberRole(m: ProjectMember, role: ProjectRole) {
    if (countOwners(members, teamRoles, { user_id: m.user_id, role }) === 0) return lastOwner();
    updateRole.mutate({ project_id: projectId, user_id: m.user_id, role }, { onError });
  }

  function removeDirect(m: ProjectMember) {
    if (countOwners(members, teamRoles, { user_id: m.user_id, role: null }) === 0) return lastOwner();
    const msg = m.team_role
      ? t('members.useTeamRoleConfirm', {
          name: displayName(m),
          teams: teamsOf(m),
          role: t(roleLabelKey[m.team_role]),
        })
      : t('members.removeConfirm');
    if (!confirm(msg)) return;
    removeMember.mutate({ project_id: projectId, user_id: m.user_id }, { onError });
  }

  function setTeamRole(team: ProjectTeam, role: ProjectRole) {
    const next = new Map(teamRoles).set(team.team_id, role);
    if (countOwners(members, next) === 0) return lastOwner();
    updateTeamRole.mutate({ project_id: projectId, team_id: team.team_id, role }, { onError });
  }

  function unlink(team: ProjectTeam) {
    const next = new Map(teamRoles);
    next.delete(team.team_id);
    if (countOwners(members, next) === 0) return lastOwner();
    if (!confirm(t('members.unlinkConfirm', { name: team.name }))) return;
    unlinkTeam.mutate({ project_id: projectId, team_id: team.team_id }, { onError });
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('members.title')}</h2>
        {canManage && (
          <div className="flex gap-2">
            <AddFromTeamDialog
              projectId={projectId}
              existingMemberIds={new Set(members.map((m) => m.user_id))}
              linkedTeamIds={new Set(teams.map((tm) => tm.team_id))}
            />
            <InviteDialog projectId={projectId} />
          </div>
        )}
      </div>

      {teams.length > 0 && (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
          <div className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
            {t('members.linkedTeams', { count: teams.length })}
          </div>
          {teams.map((team) => (
            <div key={team.team_id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                <Users size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{team.name}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t('members.teamPeople', { count: team.member_count })}
                </div>
              </div>
              {canManage ? (
                <Select
                  value={team.role}
                  onChange={(e) => setTeamRole(team, e.target.value as ProjectRole)}
                  className="h-7 text-xs"
                >
                  <option value="owner">{t('members.roleOwner')}</option>
                  <option value="editor">{t('members.roleEditor')}</option>
                  <option value="viewer">{t('members.roleViewer')}</option>
                </Select>
              ) : (
                <Badge kind={team.role}>{t(roleLabelKey[team.role])}</Badge>
              )}
              {canManage && (
                <button
                  onClick={() => unlink(team)}
                  title={t('members.unlinkTeam')}
                  className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
                >
                  <Unlink size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
        <div className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
          {t('members.active', { count: members.length })}
        </div>
        {members.map((m) => {
          const direct = directRoleOf(m);
          const viaTeams = teamsOf(m);
          let source: string;
          if (direct && m.team_role) {
            source = t('members.sourceOverride', { teams: viaTeams, role: t(roleLabelKey[m.team_role]) });
          } else if (direct) {
            source = t('members.sourceDirect');
          } else {
            source = t('members.sourceTeam', { teams: viaTeams });
          }
          return (
            <div key={m.user_id} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0 flex items-center gap-3">
              <Avatar user={m} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{displayName(m)}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {m.email && displayName(m) !== m.email ? `${m.email} · ${source}` : source}
                </div>
              </div>
              {canManage ? (
                <Select
                  value={m.role}
                  title={direct ? undefined : t('members.overrideHint')}
                  onChange={(e) => setMemberRole(m, e.target.value as ProjectRole)}
                  className="h-7 text-xs"
                >
                  {/* Highest wins: a role below what their team gives has no effect. */}
                  {(['owner', 'editor', 'viewer'] as const).map((r) => (
                    <option
                      key={r}
                      value={r}
                      disabled={!!m.team_role && roleRank[r] > roleRank[m.team_role]}
                    >
                      {t(roleLabelKey[r])}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge kind={m.role}>{t(roleLabelKey[m.role])}</Badge>
              )}
              {canManage && direct && (
                <button
                  onClick={() => removeDirect(m)}
                  title={m.team_role ? t('members.useTeamRole') : t('common.remove')}
                  className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
                >
                  {m.team_role ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                </button>
              )}
              {/* Team-only rows have nothing of their own to remove; keeps the role column aligned. */}
              {canManage && !direct && <span className="w-[22px]" />}
            </div>
          );
        })}
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

function AddFromTeamDialog({
  projectId,
  existingMemberIds,
  linkedTeamIds,
}: {
  projectId: string;
  existingMemberIds: Set<string>;
  linkedTeamIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: teams = [] } = useMyTeams();
  const { data: teamMembers = [] } = useTeamMembers(teamId || undefined);
  const addTeam = useAddTeamToProject();
  const addUser = useAddUserToProject();
  const t = useT();

  const alreadyLinked = !!teamId && linkedTeamIds.has(teamId);
  const eligible = useMemo(
    () => teamMembers.filter((m) => !existingMemberIds.has(m.user_id)),
    [teamMembers, existingMemberIds],
  );

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function linkTeam() {
    if (!teamId) return;
    try {
      const n = await addTeam.mutateAsync({ project_id: projectId, team_id: teamId, role });
      setOpen(false);
      setSelected(new Set());
      toast.success(t('projectAdd.linked_toast', { count: n }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addSelected() {
    if (selected.size === 0) return;
    let added = 0;
    for (const uid of selected) {
      try {
        await addUser.mutateAsync({ project_id: projectId, user_id: uid, role });
        added += 1;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setOpen(false);
    setSelected(new Set());
    if (added > 0) toast.success(t('projectAdd.addedCount_toast', { count: added }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSelected(new Set());
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Users size={14} /> {t('projectAdd.title')}</Button>
      </DialogTrigger>
      <DialogContent title={t('projectAdd.title')}>
        {teams.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('projectAdd.noTeams')}</div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('projectAdd.selectTeam')}</label>
              <Select className="w-full" value={teamId} onChange={(e) => { setTeamId(e.target.value); setSelected(new Set()); }}>
                <option value="">—</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
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

            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {alreadyLinked ? t('projectAdd.alreadyLinked') : t('projectAdd.linkHelp')}
            </div>

            {teamId && (
              <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-64 overflow-y-auto">
                {eligible.length === 0 ? (
                  <div className="p-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {teamMembers.length === 0 ? t('projectAdd.noOtherMembers') : t('projectAdd.alreadyMembers')}
                  </div>
                ) : (
                  eligible.map((m) => (
                    <label
                      key={m.user_id}
                      className="flex items-center gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 last:border-0 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.user_id)}
                        onChange={() => toggle(m.user_id)}
                      />
                      <Avatar user={m} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{displayName(m)}</div>
                        {m.email && displayName(m) !== m.email && (
                          <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{m.email}</div>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={linkTeam}
                disabled={!teamId || alreadyLinked || addTeam.isPending}
              >
                {t('projectAdd.linkTeam')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button onClick={addSelected} disabled={selected.size === 0 || addUser.isPending}>
                  {t('projectAdd.add')} ({selected.size})
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
