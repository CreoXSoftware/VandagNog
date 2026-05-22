import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Users, User, Check, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useCreateClient, useVisibleClients } from '@/hooks/useClients';
import { useMyTeams } from '@/hooks/useTeams';
import { useT } from '@/lib/i18n';
import type { VisibleClient } from '@/types/db';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentId: string | null;
  onPick: (clientId: string | null) => void | Promise<void>;
}

export function ClientPickerDialog({ open, onOpenChange, currentId, onPick }: Props) {
  const t = useT();
  const { data: clients = [], isLoading } = useVisibleClients();
  const { data: teams = [] } = useMyTeams();
  const create = useCreateClient();

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTeam, setNewTeam] = useState<string>('');  // '' = private

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  // Group by scope
  const groups = useMemo(() => {
    const priv: VisibleClient[] = [];
    const byTeam: Record<string, { name: string; items: VisibleClient[] }> = {};
    for (const c of filtered) {
      if (c.scope === 'private') priv.push(c);
      else if (c.team_id) {
        const k = c.team_id;
        if (!byTeam[k]) byTeam[k] = { name: c.team_name ?? '', items: [] };
        byTeam[k].items.push(c);
      }
    }
    return { priv, teams: Object.entries(byTeam) };
  }, [filtered]);

  function reset() {
    setSearch('');
    setCreating(false);
    setNewName('');
    setNewTeam('');
  }

  async function pick(id: string | null) {
    try {
      await onPick(id);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const c = await create.mutateAsync({ name, team_id: newTeam || null });
      toast.success(t('clients.created_toast'));
      await pick(c.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent title={t('clients.pickClient')}>
        {creating ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.clientName')}</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('clients.scope')}</label>
              <Select value={newTeam} onChange={(e) => setNewTeam(e.target.value)} className="w-full">
                <option value="">{t('clients.private')}</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </Select>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">{t('clients.scopeHint')}</div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
              <Button onClick={submitCreate} disabled={create.isPending || !newName.trim()}>
                {create.isPending ? t('common.creating') : t('common.create')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder={t('clients.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />

            <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-3">
              {currentId && (
                <button
                  type="button"
                  className="flex items-center gap-2 text-xs text-neutral-500 hover:text-red-600 px-2 py-1"
                  onClick={() => pick(null)}
                >
                  <X size={12} /> {t('clients.clearClient')}
                </button>
              )}
              {isLoading && (
                <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('common.loading')}</div>
              )}
              {!isLoading && groups.priv.length > 0 && (
                <Section
                  icon={<User size={12} />}
                  label={t('clients.private')}
                  items={groups.priv}
                  currentId={currentId}
                  onPick={pick}
                />
              )}
              {!isLoading && groups.teams.map(([teamId, g]) => (
                <Section
                  key={teamId}
                  icon={<Users size={12} />}
                  label={g.name}
                  items={g.items}
                  currentId={currentId}
                  onPick={pick}
                />
              ))}
              {!isLoading && filtered.length === 0 && (
                <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('clients.noneYet')}</div>
              )}
            </div>

            <div className="flex justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t('clients.newClient')}
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  label,
  items,
  currentId,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  items: VisibleClient[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 px-2 pb-1">
        {icon}<span>{label}</span>
      </div>
      <div className="space-y-0.5">
        {items.map((c) => {
          const active = c.id === currentId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              className={[
                'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm text-left',
                active
                  ? 'bg-neutral-200 dark:bg-neutral-800'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
              ].join(' ')}
            >
              <span className="truncate">{c.name}</span>
              {active && <Check size={14} className="text-neutral-700 dark:text-neutral-300 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
