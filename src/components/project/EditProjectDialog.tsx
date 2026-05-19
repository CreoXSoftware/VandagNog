import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { useUpdateProject } from '@/hooks/useProjects';
import type { Project } from '@/types/db';
import { useT } from '@/lib/i18n';

interface Props {
  project: Project;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditProjectDialog({ project, open, onOpenChange }: Props) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description ?? '');
  const update = useUpdateProject();
  const t = useT();

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDesc(project.description ?? '');
    }
  }, [open, project.name, project.description]);

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
        </div>
      </DialogContent>
    </Dialog>
  );
}
