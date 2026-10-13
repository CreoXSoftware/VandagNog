import { useMemo, useState } from 'react';
import { ChevronRight, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import {
  useCreateInvite,
  useInvites,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from '@/hooks/useMembers';
import { useOrgMembers } from '@/hooks/useOrgs';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useOrgName } from '@/lib/orgDisplay';
import type { Project, ProjectMember, ProjectRole } from '@/types/db';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { env } from '@/lib/env';
import { Avatar } from '@/components/ui/Avatar';
import { displayName } from '@/lib/userDisplay';
import { useT, type TKey } from '@/lib/i18n';

interface Props {
  project: Project;
  members: ProjectMember[];
  myRole: ProjectRole | null;
}

const roleLabelKey: Record<ProjectRole, TKey> = {
  owner: 'members.roleOwner',
  editor: 'members.roleEditor',
  viewer: 'members.roleViewer',
};

const roleRank: Record<ProjectRole, number> = { owner: 0, editor: 1, viewer: 2 };
const ROLES: ProjectRole[] = ['owner', 'editor', 'viewer'];

// What the organization alone gives this person on the project — mirrors
// project_role() on the server. An own role only counts when it is higher.
function floorOf(m: ProjectMember, createdBy: string): ProjectRole | null {
  if (m.org_role === 'owner' || m.org_role === 'admin') return 'owner';
  if (m.org_role === 'member') return m.user_id === createdBy ? 'owner' : 'editor';
  return null; // guest: only an own role
}

export function MembersPanel({ project, members, myRole }: Props) {
  const projectId = project.id;
  const { data: invites = [] } = useInvites(projectId);
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const revoke = useRevokeInvite();
  const t = useT();
  const orgName = useOrgName();
  const { orgs } = useCurrentOrg();
  const org = orgs.find((o) => o.id === project.org_id);
  const [showDefault, setShowDefault] = useState(false);

  const canManage = myRole === 'owner';
  const onError = (err: unknown) => toast.error((err as Error).message);

  // Up front: owners, guests and anyone with an own role. Org members who are
  // editors only because the org makes them so fold away below.
  const { main, orgDefault } = useMemo(() => {
    const byRoleThenName = (a: ProjectMember, b: ProjectMember) =>
      roleRank[a.role] - roleRank[b.role] || displayName(a).localeCompare(displayName(b));
    const isOrgDefault = (m: ProjectMember) =>
      m.org_role === 'member' && !m.direct_role && m.user_id !== project.created_by;
    return {
      main: members.filter((m) => !isOrgDefault(m)).sort(byRoleThenName),
      orgDefault: members.filter(isOrgDefault).sort(byRoleThenName),
    };
  }, [members, project.created_by]);

  function setMemberRole(m: ProjectMember, role: ProjectRole) {
    const floor = floorOf(m, project.created_by);
    // Back to what the org gives: drop the own role instead of storing a copy.
    if (floor === role) {
      if (m.direct_role) removeMember.mutate({ project_id: projectId, user_id: m.user_id }, { onError });
      return;
    }
    updateRole.mutate({ project_id: projectId, user_id: m.user_id, role }, { onError });
  }

  function removeDirect(m: ProjectMember) {
    const floor = floorOf(m, project.created_by);
    const msg = floor
      ? t('members.resetConfirm', { name: displayName(m), role: t(roleLabelKey[floor]) })
      : t('members.removeGuestConfirm', { name: displayName(m) });
    if (!confirm(msg)) return;
    removeMember.mutate({ project_id: projectId, user_id: m.user_id }, { onError });
  }

  function sourceOf(m: ProjectMember): string {
    if (m.org_role === 'owner') return t('members.sourceOrgOwner');
    if (m.org_role === 'admin') return t('members.sourceOrgAdmin');
    if (m.org_role === 'guest') return t('members.sourceGuest');
    if (m.org_role === 'member') {
      if (m.user_id === project.created_by) return t('members.sourceCreator');
      return m.direct_role ? t('members.sourceMemberOwn') : t('members.sourceMember');
    }
    return t('members.sourceDirect');
  }

  function row(m: ProjectMember) {
    const floor = floorOf(m, project.created_by);
    // An own role can always be dropped: a member falls back to what the org
    // gives (reset), a guest loses access (remove).
    const source = sourceOf(m);
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
            title={floor ? t('members.floorHint') : undefined}
            onChange={(e) => setMemberRole(m, e.target.value as ProjectRole)}
            className="h-7 text-xs"
            aria-label={t('common.role')}
          >
            {/* Highest wins: a role below what the org gives has no effect. */}
            {ROLES.map((r) => (
              <option key={r} value={r} disabled={!!floor && roleRank[r] > roleRank[floor]}>
                {t(roleLabelKey[r])}
              </option>
            ))}
          </Select>
        ) : (
          <Badge kind={m.role}>{t(roleLabelKey[m.role])}</Badge>
        )}
        {canManage && m.direct_role ? (
          <button
            onClick={() => removeDirect(m)}
            title={floor ? t('members.reset') : t('common.remove')}
            aria-label={floor ? t('members.reset') : t('common.remove')}
            className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
          >
            {floor ? <RotateCcw size={14} /> : <Trash2 size={14} />}
          </button>
        ) : (
          // Keeps the role column aligned.
          canManage && <span className="w-[22px]" />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('members.title')}</h2>
          {org && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {org.is_personal ? t('members.personalHint') : t('members.orgHint', { org: orgName(org) })}
            </div>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            {org && org.my_role !== 'guest' && (
              <AddFromOrgDialog project={project} members={members} />
            )}
            <InviteDialog projectId={projectId} />
          </div>
        )}
      </div>

      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
        <div className="px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
          {t('members.active', { count: main.length })}
        </div>
        {main.map(row)}
      </div>

      {orgDefault.length > 0 && (
        <div>
          <button
            onClick={() => setShowDefault((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            <ChevronRight size={14} className={showDefault ? 'rotate-90 transition-transform' : 'transition-transform'} />
            {t('members.orgEditors', { count: orgDefault.length, org: org ? orgName(org) : '' })}
          </button>
          {showDefault && (
            <div className="mt-2 border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
              {orgDefault.map(row)}
            </div>
          )}
        </div>
      )}

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

// Share the project with guests of its org who don't have access yet (members
// already edit every project; make one an owner from the list instead).
function AddFromOrgDialog({ project, members }: { project: Project; members: ProjectMember[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ProjectRole>('editor');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: people = [], isLoading } = useOrgMembers(open ? project.org_id : undefined);
  const addUser = useUpdateMemberRole();

  const eligible = useMemo(() => {
    const hasAccess = new Set(members.map((m) => m.user_id));
    return people
      .filter((p) => !hasAccess.has(p.user_id))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }, [people, members]);

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function addSelected() {
    let added = 0;
    for (const uid of selected) {
      try {
        await addUser.mutateAsync({ project_id: project.id, user_id: uid, role });
        added += 1;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setOpen(false);
    setSelected(new Set());
    if (added > 0) toast.success(t('members.addedCount_toast', { count: added }));
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
        <Button size="sm" variant="outline"><UserPlus size={14} /> {t('members.addFromOrg')}</Button>
      </DialogTrigger>
      <DialogContent title={t('members.addFromOrg')}>
        <div className="space-y-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('members.addFromOrgHelp')}</div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.role')}</label>
            <Select className="w-full" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
              <option value="editor">{t('members.roleEditor')}</option>
              <option value="viewer">{t('members.roleViewer')}</option>
              <option value="owner">{t('members.roleOwner')}</option>
            </Select>
          </div>
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-md max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="p-3 text-xs text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
            ) : eligible.length === 0 ? (
              <div className="p-3 text-xs text-neutral-500 dark:text-neutral-400">{t('members.nobodyToAdd')}</div>
            ) : (
              eligible.map((p) => (
                <label
                  key={p.user_id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 last:border-0 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <input type="checkbox" checked={selected.has(p.user_id)} onChange={() => toggle(p.user_id)} />
                  <Avatar user={p} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{displayName(p)}</div>
                    {p.email && displayName(p) !== p.email && (
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{p.email}</div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={addSelected} disabled={selected.size === 0 || addUser.isPending}>
              {t('common.add')} ({selected.size})
            </Button>
          </div>
        </div>
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
