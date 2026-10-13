import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useCreateClient, useDeleteClient, useOrgClients, useUpdateClient } from '@/hooks/useClients';
import { orgRoleAtLeast } from '@/hooks/useOrgs';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useOrgName } from '@/lib/orgDisplay';
import { useT } from '@/lib/i18n';
import type { Client } from '@/types/db';

// The clients of the current organization. Members add them; owners/admins
// (or whoever added one) rename and delete. Guests only see the clients of
// projects shared with them.
export function ClientsListPage() {
  const t = useT();
  const { org } = useCurrentOrg();
  const orgName = useOrgName();
  const { data: clients = [], isLoading } = useOrgClients(org.id);
  const { user } = useAuth();
  const isGuest = org.my_role === 'guest';
  const isAdmin = orgRoleAtLeast(org.my_role, 'admin');

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">{t('clients.title')}</h1>
          {!isGuest && <NewClientDialog orgId={org.id} />}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-6">
          {isGuest ? t('clients.guestHint', { org: orgName(org) }) : t('clients.orgHint', { org: orgName(org) })}
        </div>

        {isLoading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
        ) : clients.length === 0 ? (
          <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
            <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('clients.noneYet')}</div>
            {!isGuest && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('clients.createToStart')}</div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => (
              <ClientRow
                key={c.id}
                client={c}
                canEdit={isAdmin || (!isGuest && c.created_by === user?.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientRow({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const t = useT();
  const update = useUpdateClient();
  const del = useDeleteClient();
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(client.name);

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
      <div className="flex-1 min-w-0 font-medium text-sm truncate">{client.name}</div>
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
    </div>
  );
}

function NewClientDialog({ orgId }: { orgId: string }) {
  const t = useT();
  const create = useCreateClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function onOpen(v: boolean) {
    if (v) setName('');
    setOpen(v);
  }

  async function submit() {
    const n = name.trim();
    if (!n) return;
    try {
      await create.mutateAsync({ name: n, org_id: orgId });
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              autoFocus
            />
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
