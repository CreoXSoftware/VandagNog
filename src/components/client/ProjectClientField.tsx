import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Users, User } from 'lucide-react';
import { ClientPickerDialog } from './ClientPicker';
import { useProjectClient, useSetProjectClient } from '@/hooks/useClients';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';

interface Props {
  projectId: string;
  canEdit: boolean;
}

export function ProjectClientField({ projectId, canEdit }: Props) {
  const t = useT();
  const { data: info } = useProjectClient(projectId);
  const setClient = useSetProjectClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  async function onPick(clientId: string | null) {
    await setClient.mutateAsync({ project_id: projectId, client_id: clientId });
    toast.success(t('clients.updated_toast'));
  }

  const label = info
    ? info.scope === 'team'
      ? t('clients.scopeTeam', { team: info.team_name ?? '' })
      : info.owner_user_id === user?.id
        ? t('clients.scopePrivateMine')
        : t('clients.scopePrivateOther', { name: info.owner_display_name ?? '' })
    : null;

  const scopeIcon = info?.scope === 'team' ? <Users size={11} /> : info ? <User size={11} /> : null;

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
          <>
            <span className="font-medium text-neutral-800 dark:text-neutral-100 truncate max-w-[140px]">
              {info.client_name}
            </span>
            <span className="flex items-center gap-0.5 text-neutral-500 dark:text-neutral-400">
              {scopeIcon}
              <span className="truncate max-w-[160px]">{label}</span>
            </span>
          </>
        ) : (
          <span className="text-neutral-500 dark:text-neutral-400">{t('clients.noClient')}</span>
        )}
      </button>

      {canEdit && (
        <ClientPickerDialog
          open={open}
          onOpenChange={setOpen}
          currentId={info?.client_id ?? null}
          onPick={onPick}
        />
      )}
    </>
  );
}
