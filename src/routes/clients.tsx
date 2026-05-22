import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ArrowUpRight, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import {
  useCreateClient,
  useDeleteClient,
  useMyClients,
  usePromoteClient,
  useUpdateClient,
} from '@/hooks/useClients';
import { useMyTeams } from '@/hooks/useTeams';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';
import type { Client, TeamSummary } from '@/types/db';

export function ClientsListPage() {
  const t = useT();
  const { data: clients = [], isLoading } = useMyClients();
  const { data: teams = [] } = useMyTeams();
  const { user } = useAuth();
  const me = user?.id ?? null;

  const [tab, setTab] = useState<string>('private'); // 'private' or team_id

  const grouped = useMemo(() => {
    const priv: Client[] = [];
    const byTeam: Record<string, Client[]> = {};
    for (const c of clients) {
      if (c.team_id) {
        (byTeam[c.team_id] ||= []).push(c);
      } else if (c.owner_user_id === me) {
        priv.push(c);
      }
    }
    return { priv, byTeam };
  }, [clients, me]);

  const teamForTab = teams.find((tm) => tm.id === tab) ?? null;
  const activeList = tab === 'private' ? grouped.priv : grouped.byTeam[tab] ?? [];

  return (
    <div className="max-w-4xl mx-auto p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t('clients.title')}</h1>
        <NewClientDialog teams={teams} initialTeam={tab !== 'private' ? tab : ''} />
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-neutral-200 dark:border-neutral-800">
        <TabButton active={tab === 'private'} onClick={() => setTab('private')}>
          <User size={12} /> {t('clients.privateTab')}
        </TabButton>
        {teams.map((tm) => (
          <TabButton key={tm.id} active={tab === tm.id} onClick={() => setTab(tm.id)}>
            <Users size={12} /> {tm.name}
          </TabButton>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
      ) : activeList.length === 0 ? (
        <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
          <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('clients.noneYet')}</div>
          <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t('clients.createToStart')}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {activeList.map((c) => (
            <ClientRow
              key={c.id}
              client={c}
              me={me}
              team={teamForTab}
              teams={teams}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
        active
          ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
          : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ClientRow({
  client,
  me,
  team,
  teams,
}: {
  client: Client;
  me: string | null;
  team: TeamSummary | null;
  teams: TeamSummary[];
}) {
  const t = useT();
  const update = useUpdateClient();
  const del = useDeleteClient();
  const [editOpen, setEditOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [name, setName] = useState(client.name);

  const isPrivate = !!client.owner_user_id;
  const canEdit = isPrivate
    ? client.owner_user_id === me
    : team?.my_role === 'owner';

  async function save() {
    const n = name.trim();
    if (!n || n === client.name) {
      setEditOpen(false);
      return;
    }
    try {
      await update.mutateAsync({ id: client.id, name: n });
      toast.success(t('clients.updated_toast'));
      setEditOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove() {
    if (!confirm(t('clients.deleteConfirm', { name: client.name }))) return;
    try {
      await del.mutateAsync(client.id);
      toast.success(t('clients.deleted_toast'));
    } catch (err) {
      const msg = (err as Error).message;
      // Postgres FK restrict → friendly hint
      if (/foreign key|restrict|violates/i.test(msg)) {
        toast.error(t('clients.deleteBlocked'));
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 bg-white dark:bg-neutral-900 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{client.name}</div>
        {!canEdit && !isPrivate && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">{t('clients.teamAdminOnly')}</div>
        )}
      </div>
      {isPrivate && teams.length > 0 && client.owner_user_id === me && (
        <Button variant="ghost" size="sm" onClick={() => setPromoteOpen(true)} title={t('clients.promote')}>
          <ArrowUpRight size={14} /> {t('clients.promote')}
        </Button>
      )}
      {canEdit && (
        <>
          <button
            onClick={() => { setName(client.name); setEditOpen(true); }}
            className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
            aria-label={t('common.edit')}
            title={t('common.edit')}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={remove}
            className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent title={t('clients.renameTitle')}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.clientName')}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={save} disabled={update.isPending || !name.trim()}>
                {update.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        client={client}
        teams={teams}
      />
    </div>
  );
}

function PromoteDialog({
  open,
  onOpenChange,
  client,
  teams,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: Client;
  teams: TeamSummary[];
}) {
  const t = useT();
  const promote = usePromoteClient();
  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? '');

  async function submit() {
    if (!teamId) return;
    try {
      await promote.mutateAsync({ client_id: client.id, team_id: teamId });
      toast.success(t('clients.promoted_toast'));
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('clients.promoteTitle')}>
        <div className="space-y-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('clients.promoteHint')}</div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.teamLabel')}</label>
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full">
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={promote.isPending || !teamId}>
              {promote.isPending ? '…' : t('clients.promoteSubmit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewClientDialog({ teams, initialTeam }: { teams: TeamSummary[]; initialTeam: string }) {
  const t = useT();
  const create = useCreateClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [team, setTeam] = useState<string>(initialTeam);

  function onOpen(v: boolean) {
    if (v) {
      setName('');
      setTeam(initialTeam);
    }
    setOpen(v);
  }

  async function submit() {
    const n = name.trim();
    if (!n) return;
    try {
      await create.mutateAsync({ name: n, team_id: team || null });
      toast.success(t('clients.created_toast'));
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogTrigger asChild>
        <Button><Plus size={14} /> {t('clients.newClient')}</Button>
      </DialogTrigger>
      <DialogContent title={t('clients.newClient')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.clientName')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.scope')}</label>
            <Select value={team} onChange={(e) => setTeam(e.target.value)} className="w-full">
              <option value="">{t('clients.private')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </Select>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">{t('clients.scopeHint')}</div>
          </div>
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
