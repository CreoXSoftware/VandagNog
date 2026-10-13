import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { useDeleteProject, useMoveProject, useRestoreProject, useUpdateProject } from '@/hooks/useProjects';
import { useCurrentOrg } from '@/lib/currentOrg';
import { useOrgName } from '@/lib/orgDisplay';
import type { Project } from '@/types/db';
import { useT } from '@/lib/i18n';

interface Props {
  project: Project;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// Project settings — owners only (org owners/admins, the creator, project owners).
export function EditProjectDialog({ project, open, onOpenChange }: Props) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description ?? '');
  const [orgId, setOrgIdField] = useState(project.org_id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedName, setTypedName] = useState('');
  const update = useUpdateProject();
  const move = useMoveProject();
  const del = useDeleteProject();
  const restore = useRestoreProject();
  const navigate = useNavigate();
  const { orgs, setOrgId } = useCurrentOrg();
  const orgName = useOrgName();
  const t = useT();

  // Orgs it can move to: ones I'm a member of (guests can't add projects).
  const targets = orgs.filter((o) => o.id === project.org_id || o.my_role !== 'guest');

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDesc(project.description ?? '');
      setOrgIdField(project.org_id);
      setConfirmingDelete(false);
      setTypedName('');
    }
  }, [open, project.name, project.description, project.org_id]);

  async function deleteProject() {
    const id = project.id;
    try {
      await del.mutateAsync(id);
      onOpenChange(false);
      navigate({ to: '/projects' });
      toast.success(t('projects.deleted_toast'), {
        action: {
          label: t('projects.undo'),
          onClick: () =>
            restore.mutate(id, {
              onSuccess: () => toast.success(t('projects.restored_toast')),
              onError: (err) => toast.error((err as Error).message),
            }),
        },
      });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDesc = desc.trim();
    const moving = orgId !== project.org_id;
    if (moving) {
      const target = orgs.find((o) => o.id === orgId);
      if (!confirm(t('projects.moveConfirm', { name: project.name, org: target ? orgName(target) : '' }))) return;
    }
    try {
      if (trimmedName !== project.name || (trimmedDesc || null) !== project.description) {
        await update.mutateAsync({
          id: project.id,
          patch: {
            name: trimmedName,
            description: trimmedDesc ? trimmedDesc : null,
          },
        });
      }
      if (moving) {
        await move.mutateAsync({ id: project.id, org_id: orgId });
        // Follow the project into its new organization.
        setOrgId(orgId);
      }
      onOpenChange(false);
      toast.success(t(moving ? 'projects.moved_toast' : 'projects.updated_toast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('projects.editProject')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.description')}</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {targets.length > 1 && (
            <div>
              <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('projects.organization')}</label>
              <Select className="w-full" value={orgId} onChange={(e) => setOrgIdField(e.target.value)}>
                {targets.map((o) => (
                  <option key={o.id} value={o.id}>{orgName(o)}</option>
                ))}
              </Select>
              {orgId !== project.org_id && (
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">{t('projects.moveHelp')}</div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={update.isPending || move.isPending || !name.trim()}>
              {update.isPending || move.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 space-y-2">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('projects.deleteHelp')}</div>
            {confirmingDelete ? (
              <>
                <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  {t('projects.deleteTypeName', { name: project.name })}
                </label>
                <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={deleteProject}
                    disabled={del.isPending || typedName.trim() !== project.name.trim()}
                  >
                    {t('projects.deleteProject')}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 dark:text-red-400"
                onClick={() => setConfirmingDelete(true)}
              >
                {t('projects.deleteProject')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
