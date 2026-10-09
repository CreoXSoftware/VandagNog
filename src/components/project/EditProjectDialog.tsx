import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { useDeleteProject, useRestoreProject, useUpdateProject } from '@/hooks/useProjects';
import type { Project } from '@/types/db';
import { useT } from '@/lib/i18n';

interface Props {
  project: Project;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canDelete?: boolean;
}

export function EditProjectDialog({ project, open, onOpenChange, canDelete = false }: Props) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedName, setTypedName] = useState('');
  const update = useUpdateProject();
  const del = useDeleteProject();
  const restore = useRestoreProject();
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDesc(project.description ?? '');
      setConfirmingDelete(false);
      setTypedName('');
    }
  }, [open, project.name, project.description]);

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
    try {
      await update.mutateAsync({
        id: project.id,
        patch: {
          name: trimmedName,
          description: trimmedDesc ? trimmedDesc : null,
        },
      });
      onOpenChange(false);
      toast.success(t('projects.updated_toast'));
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
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={update.isPending || !name.trim()}>
              {update.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
          {canDelete && (
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
