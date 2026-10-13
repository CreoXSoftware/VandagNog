import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Copy, LogOut, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Avatar } from '@/components/ui/Avatar';
import { orgRoleKey, useOrgName } from '@/lib/orgDisplay';
import {
  useDeleteOrg,
  useOrgMembers,
  useRegenerateOrgCode,
  useRemoveOrgMember,
  useSetOrgMemberRole,
  useUpdateOrg,
} from '@/hooks/useOrgs';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentOrg } from '@/lib/currentOrg';
import { displayName } from '@/lib/userDisplay';
import { env } from '@/lib/env';
import { useT, type TKey } from '@/lib/i18n';
import type { OrgMember, OrgRole, Organization, ProjectRole } from '@/types/db';

const ROLES: OrgRole[] = ['owner', 'admin', 'member', 'guest'];
const ROLE_ORDER: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2, guest: 3 };

const projectRoleKey: Record<ProjectRole, TKey> = {
  owner: 'members.roleOwner',
  editor: 'members.roleEditor',
  viewer: 'members.roleViewer',
};

export function OrgPage() {
  const t = useT();
  const orgName = useOrgName();
  const { orgId } = useParams({ from: '/_app/orgs/$orgId' });
  const { org: current, orgs, setOrgId } = useCurrentOrg();
  const org = orgs.find((o) => o.id === orgId);
  const { data: people = [], isLoading } = useOrgMembers(org && org.my_role !== 'guest' ? orgId : undefined);
  const { user } = useAuth();
  const navigate = useNavigate();
  const remove = useRemoveOrgMember();
  const del = useDeleteOrg();
  const [editing, setEditing] = useState(false);

  const { members, guests } = useMemo(() => {
    const byName = (a: OrgMember, b: OrgMember) => displayName(a).localeCompare(displayName(b));
    return {
      members: people
        .filter((p) => p.role !== 'guest')
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byName(a, b)),
      guests: people.filter((p) => p.role === 'guest').sort(byName),
    };
  }, [people]);

  if (!org) {
    return (
      <div className="p-6 text-sm text-neutral-500 dark:text-neutral-400 space-y-2">
        <div>{t('orgs.notFound')}</div>
        <Link to="/orgs" className="text-sky-700 dark:text-sky-400 hover:underline">{t('orgs.backToList')}</Link>
      </div>
    );
  }

  const me = org.my_role;
  const isOwner = me === 'owner';
  const isAdmin = me === 'owner' || me === 'admin';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  async function leave() {
    if (!org || !user) return;
    if (!confirm(t('orgs.leaveConfirm', { name: org.name }))) return;
    try {
      await remove.mutateAsync({ org_id: org.id, user_id: user.id });
      toast.success(t('orgs.left_toast', { name: org.name }));
      navigate({ to: '/orgs' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteOrg() {
    if (!org) return;
    if (!confirm(t('orgs.deleteConfirm', { name: org.name }))) return;
    try {
      await del.mutateAsync(org.id);
      toast.success(t('orgs.deleted_toast'));
      navigate({ to: '/orgs' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/orgs" className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" aria-label={t('orgs.backToList')}>
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-xl font-semibold truncate">{orgName(org)}</h1>
          {!org.is_personal && <Badge kind={me}>{t(orgRoleKey[me])}</Badge>}
          <div className="flex-1" />
          {org.id !== current.id && (
            <Button variant="outline" size="sm" onClick={() => setOrgId(org.id)}>{t('orgs.switchTo')}</Button>
          )}
          {!org.is_personal && isAdmin && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} /> {t('common.edit')}
            </Button>
          )}
          {!org.is_personal && (
            <Button variant="outline" size="sm" onClick={leave} disabled={remove.isPending}>
              <LogOut size={14} /> {t('orgs.leave')}
            </Button>
          )}
          {!org.is_personal && isOwner && (
            <Button variant="outline" size="sm" className="text-red-600 dark:text-red-400" onClick={deleteOrg} disabled={del.isPending}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          )}
        </div>

        {editing ? (
          <EditOrgForm org={org} onDone={() => setEditing(false)} />
        ) : (
          org.description && <div className="text-sm text-neutral-600 dark:text-neutral-400 -mt-3">{org.description}</div>
        )}

        {org.is_personal && <Hint>{t('orgs.personalHint')}</Hint>}
        {me === 'guest' && <Hint>{t('orgs.guestHint', { name: org.name })}</Hint>}

        {!org.is_personal && isAdmin && org.invite_code && <InviteCodeCard org={org} />}

        {me !== 'guest' && (
          <>
            {!org.is_personal && (
              <Section title={t('orgs.membersHeading', { count: members.length })} hint={t('orgs.membersHint')}>
                {isLoading ? (
                  <Empty>{t('common.loading')}</Empty>
                ) : (
                  members.map((m) => (
                    <PersonRow
                      key={m.user_id}
                      org={org}
                      person={m}
                      isMe={m.user_id === user?.id}
                      ownerCount={ownerCount}
                    />
                  ))
                )}
              </Section>
            )}

            <Section title={t('orgs.guestsHeading', { count: guests.length })} hint={t('orgs.guestsHint')}>
              {isLoading ? (
                <Empty>{t('common.loading')}</Empty>
              ) : guests.length === 0 ? (
                <Empty>{t('orgs.noGuests')}</Empty>
              ) : (
                guests.map((g) => (
                  <PersonRow key={g.user_id} org={org} person={g} isMe={g.user_id === user?.id} ownerCount={ownerCount}>
                    {g.projects.length === 0 ? (
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{t('orgs.guestNoProjects')}</div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {g.projects.map((p) => (
                          <Link
                            key={p.id}
                            to="/projects/$projectId"
                            params={{ projectId: p.id }}
                            search={{ view: 'members' }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-[11px] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <span className="truncate max-w-[200px]">{p.name}</span>
                            <span className="text-neutral-400 dark:text-neutral-500">· {t(projectRoleKey[p.role])}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </PersonRow>
                ))
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 px-4 py-3 text-xs text-sky-900 dark:text-sky-200">
      {children}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{hint}</div>
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900">
        {children}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">{children}</div>;
}

// One person: role (a select for owners), remove, and for guests their projects below.
function PersonRow({
  org,
  person,
  isMe,
  ownerCount,
  children,
}: {
  org: Organization;
  person: OrgMember;
  isMe: boolean;
  ownerCount: number;
  children?: React.ReactNode;
}) {
  const t = useT();
  const setRole = useSetOrgMemberRole();
  const remove = useRemoveOrgMember();
  const me = org.my_role;
  const lastOwner = person.role === 'owner' && ownerCount <= 1;
  const canSetRole = me === 'owner' && !org.is_personal && !(isMe && lastOwner);
  const canRemove =
    !isMe && (me === 'owner' || (me === 'admin' && (person.role === 'member' || person.role === 'guest')));

  function changeRole(role: OrgRole) {
    if (isMe && !confirm(t('orgs.changeOwnRoleConfirm'))) return;
    setRole.mutate(
      { org_id: org.id, user_id: person.user_id, role },
      {
        onSuccess: () => toast.success(t('orgs.roleChanged_toast', { name: displayName(person) })),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  function removePerson() {
    if (!confirm(t('orgs.removeConfirm', { name: displayName(person), org: org.name }))) return;
    remove.mutate(
      { org_id: org.id, user_id: person.user_id },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  return (
    <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-0">
      <div className="flex items-center gap-3">
        <Avatar user={person} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {displayName(person)}
            {isMe && <span className="ml-1.5 text-xs font-normal text-neutral-400">({t('orgs.you')})</span>}
          </div>
          {person.email && displayName(person) !== person.email && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{person.email}</div>
          )}
        </div>
        {canSetRole ? (
          <Select
            value={person.role}
            onChange={(e) => changeRole(e.target.value as OrgRole)}
            disabled={setRole.isPending}
            className="h-7 text-xs"
            aria-label={t('common.role')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(orgRoleKey[r])}</option>
            ))}
          </Select>
        ) : (
          !org.is_personal && <Badge kind={person.role}>{t(orgRoleKey[person.role])}</Badge>
        )}
        {canRemove ? (
          <button
            onClick={removePerson}
            title={t('common.remove')}
            aria-label={t('common.remove')}
            className="p-1 text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <span className="w-[22px]" />
        )}
      </div>
      {children && <div className="mt-2 pl-11">{children}</div>}
    </div>
  );
}

function InviteCodeCard({ org }: { org: Organization }) {
  const t = useT();
  const regen = useRegenerateOrgCode();
  const code = org.invite_code ?? '';

  async function copy(text: string, msg: TKey) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toast.success(t(msg));
  }

  async function doRegen() {
    if (!confirm(t('orgs.regenerateConfirm'))) return;
    try {
      await regen.mutateAsync(org.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4">
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2">{t('orgs.inviteCode')}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-sm px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 break-all">
          {code}
        </code>
        <Button variant="outline" size="sm" onClick={() => copy(code, 'orgs.codeCopied_toast')} title={t('orgs.copyCode')}>
          <Copy size={14} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => copy(`${env.APP_URL}/orgs?join=${code}`, 'orgs.linkCopied_toast')}>
          {t('orgs.copyLink')}
        </Button>
        <Button variant="outline" size="sm" onClick={doRegen} disabled={regen.isPending} title={t('orgs.regenerateCode')}>
          <RefreshCw size={14} />
        </Button>
      </div>
      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-2">{t('orgs.inviteCodeHint')}</div>
    </div>
  );
}

function EditOrgForm({ org, onDone }: { org: Organization; onDone: () => void }) {
  const t = useT();
  const update = useUpdateOrg();
  const [name, setName] = useState(org.name);
  const [desc, setDesc] = useState(org.description ?? '');

  async function save() {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({ id: org.id, name: name.trim(), description: desc.trim() || null });
      toast.success(t('orgs.updated_toast'));
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg bg-white dark:bg-neutral-900 p-4 space-y-3">
      <div>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('orgs.orgName')}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('orgs.descriptionOptional')}</label>
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={save} disabled={update.isPending || !name.trim()}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
