import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Check, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useCreateClient, useOrgClients } from '@/hooks/useClients';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useT } from '@/lib/i18n';
import type { Client } from '@/types/db';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The project's organization: only its clients can be linked. */
  orgId: string;
  currentId: string | null;
  onPick: (clientId: string | null) => void | Promise<void>;
}

export function ClientPickerDialog({ open, onOpenChange, orgId, currentId, onPick }: Props) {
  const t = useT();
  const { orgs } = useCurrentOrg();
  const { data: clients = [], isLoading } = useOrgClients(open ? orgId : undefined);
  const create = useCreateClient();
  // Guests can link a client they can see, but not add one to the org.
  const canCreate = orgs.find((o) => o.id === orgId)?.my_role !== 'guest';

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  function reset() {
    setSearch('');
    setCreating(false);
    setNewName('');
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
      const c = await create.mutateAsync({ name, org_id: orgId });
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
              {!isLoading && <ClientList items={filtered} currentId={currentId} onPick={pick} />}
              {!isLoading && filtered.length === 0 && (
                <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('clients.noneYet')}</div>
              )}
            </div>

            <div className="flex justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
              {canCreate ? (
                <Button variant="outline" onClick={() => setCreating(true)}>
                  <Plus size={14} /> {t('clients.newClient')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClientList({
  items,
  currentId,
  onPick,
}: {
  items: Client[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
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
