import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, FileJson, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Dependency, WorkItem } from '@/types/db';
import { exportProjectJson } from '@/lib/bulkExport';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Props {
  projectName: string;
  workItems: WorkItem[];
  dependencies: Dependency[];
}

export function ProjectExportMenu({ projectName, workItems, dependencies }: Props) {
  const t = useT();

  function exportJson() {
    if (workItems.length === 0) {
      toast.error(t('export.empty'));
      return;
    }
    try {
      exportProjectJson(projectName, workItems, dependencies);
      toast.success(t('export.done'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const itemClass = cn(
    'flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none',
    'text-neutral-700 dark:text-neutral-200',
    'data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800',
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-1.5 h-6 rounded text-[11px] text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 whitespace-nowrap outline-none"
          title={t('export.title')}
        >
          <Download size={12} />
          {t('export.label')}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          <DropdownMenu.Item className={itemClass} onSelect={exportJson}>
            <FileJson size={14} className="text-neutral-500 dark:text-neutral-400" />
            {t('export.json')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
