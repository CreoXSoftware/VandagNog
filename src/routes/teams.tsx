import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, LogIn, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useCreateTeam, useJoinTeam, useMyTeams } from '@/hooks/useTeams';
import { useT } from '@/lib/i18n';

export function TeamsListPage() {
  const { data = [], isLoading } = useMyTeams();
  const search = useSearch({ from: '/_app/teams' }) as { join?: string };
  const navigate = useNavigate();
  const join = useJoinTeam();
  const handled = useRef<string | null>(null);
  const t = useT();

  useEffect(() => {
    const code = search?.join?.trim();
    if (!code || handled.current === code) return;
    handled.current = code;
    join.mutateAsync(code)
      .then((team) => {
        toast.success(t('teams.joined_toast'));
        navigate({ to: '/teams/$teamId', params: { teamId: team.id } });
      })
      .catch((e) => toast.error((e as Error).message));
  }, [search?.join, join, navigate, t]);

  return (
    <div className="max-w-4xl mx-auto p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t('teams.title')}</h1>
        <div className="flex gap-2">
          <JoinTeamDialog />
          <NewTeamDialog />
        </div>
      </div>
      {isLoading ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
      ) : data.length === 0 ? (
        <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
          <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('teams.noneYet')}</div>
          <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t('teams.createOrJoin')}</div>
          <div className="flex gap-2 justify-center">
            <JoinTeamDialog />
            <NewTeamDialog />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.map((team) => (
            <Link
              key={team.id}
              to="/teams/$teamId"
              params={{ teamId: team.id }}
              className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Users size={16} className="text-neutral-500" />
                <div className="font-medium flex-1 truncate">{team.name}</div>
                {team.my_role === 'owner' && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {t('teams.roleOwner')}
                  </span>
                )}
              </div>
              {team.description && (
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{team.description}</div>
              )}
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-3">
                {t('teams.memberCount', { count: team.member_count })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTeamDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useCreateTeam();
  const t = useT();

  async function submit() {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: desc.trim() || null });
      setName('');
      setDesc('');
      setOpen(false);
      toast.success(t('teams.created_toast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus size={14} /> {t('teams.newTeam')}</Button>
      </DialogTrigger>
      <DialogContent title={t('teams.newTeam')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('teams.teamName')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('teams.descriptionOptional')}</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
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

function JoinTeamDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const join = useJoinTeam();
  const t = useT();

  async function submit() {
    const c = code.trim();
    if (!c) return;
    try {
      await join.mutateAsync(c);
      setCode('');
      setOpen(false);
      toast.success(t('teams.joined_toast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><LogIn size={14} /> {t('teams.joinTeam')}</Button>
      </DialogTrigger>
      <DialogContent title={t('teams.joinByCode')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('teams.inviteCode')}</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('teams.enterCode')}
              autoFocus
              className="font-mono"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={join.isPending || !code.trim()}>
              {join.isPending ? '…' : t('teams.joinTeam')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
