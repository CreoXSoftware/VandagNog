import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import { useCreateProject, useProjects } from '@/hooks/useProjects';
import { toast } from 'sonner';
import { formatDate } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export function ProjectsListPage() {
  const { data = [], isLoading } = useProjects();
  const t = useT();
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t('projects.title')}</h1>
        <NewProjectDialog />
      </div>
      {isLoading ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
      ) : data.length === 0 ? (
        <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-10 text-center">
          <div className="text-neutral-700 dark:text-neutral-200 font-medium mb-1">{t('projects.noneYet')}</div>
          <div className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{t('projects.createToStart')}</div>
          <NewProjectDialog />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.map((p) => (
            <Link
              key={p.id}
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-4 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors"
            >
              <div className="font-medium">{p.name}</div>
              {p.description && (
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">{p.description}</div>
              )}
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-3">{t('projects.created', { date: formatDate(p.created_at) })}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useCreateProject();
  const t = useT();

  async function submit() {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: desc.trim() || undefined });
      setName('');
      setDesc('');
      setOpen(false);
      toast.success(t('projects.created_toast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus size={14} /> {t('projects.newProject')}</Button>
      </DialogTrigger>
      <DialogContent title={t('projects.newProject')}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('common.name')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('projects.descriptionOptional')}</label>
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
