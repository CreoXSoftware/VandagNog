import { useState } from 'react';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import { ClientPickerDialog } from './ClientPicker';
import { useProjectClient, useSetProjectClient } from '@/hooks/useClients';
import { useT } from '@/lib/i18n';

interface Props {
  projectId: string;
  /** The project's organization: its clients are the ones to pick from. */
  orgId: string;
  canEdit: boolean;
}

export function ProjectClientField({ projectId, orgId, canEdit }: Props) {
  const t = useT();
  const { data: info } = useProjectClient(projectId);
  const setClient = useSetProjectClient();
  const [open, setOpen] = useState(false);

  async function onPick(clientId: string | null) {
    await setClient.mutateAsync({ project_id: projectId, client_id: clientId });
    toast.success(t('clients.updated_toast'));
  }

  return (
    <>
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => canEdit && setOpen(true)}
        title={canEdit ? t('clients.pickClient') : t('clients.ownerOnly')}
        className={[
          'flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-neutral-200 dark:border-neutral-800',
          'bg-neutral-50 dark:bg-neutral-900',
          canEdit ? 'hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer' : 'cursor-default opacity-90',
        ].join(' ')}
      >
        <Building2 size={12} className="text-neutral-500" />
        {info ? (
          <span className="font-medium text-neutral-800 dark:text-neutral-100 truncate max-w-[180px]">
            {info.client_name}
          </span>
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400">{t('clients.noClient')}</span>
        )}
      </button>

      {canEdit && (
        <ClientPickerDialog
          open={open}
          onOpenChange={setOpen}
          orgId={orgId}
          currentId={info?.client_id ?? null}
          onPick={onPick}
        />
      )}
    </>
  );
}
