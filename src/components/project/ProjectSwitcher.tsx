import { useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDown, Check, Search } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Props {
  currentProjectId: string;
  name: string;
  description?: string | null;
}

export function ProjectSwitcher({ currentProjectId, name, description }: Props) {
  const t = useT();
  const nav = useNavigate();
  const search = useSearch({ from: '/_app/projects/$projectId' });
  const { data: projects = [] } = useProjects();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, q]);

  function go(id: string) {
    setOpen(false);
    if (id === currentProjectId) return;
    // Keep the current view (gantt/calendar/members); drop item/tab from the old project.
    nav({ to: '/projects/$projectId', params: { projectId: id }, search: { view: search.view } });
  }

  const triggerClass = cn(
    'flex items-center gap-1 font-medium text-sm rounded px-1.5 py-1 -mx-1 max-w-[260px] outline-none',
    'hover:bg-neutral-100 dark:hover:bg-neutral-800',
    'data-[state=open]:bg-neutral-100 dark:data-[state=open]:bg-neutral-800',
  );

  const trigger = (
    <Popover.Trigger asChild>
      <button type="button" title={t('project.switch')} aria-label={t('project.switch')} className={triggerClass}>
        <span className="truncate">{name}</span>
        <ChevronDown size={13} className="opacity-50 shrink-0" />
      </button>
    </Popover.Trigger>
  );

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
      {description ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap">
            {description}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 w-64 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          <div className="flex items-center gap-1.5 px-1.5 pb-1 mb-1 border-b border-neutral-100 dark:border-neutral-800">
            <Search size={13} className="text-neutral-400 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = filtered.find((p) => p.id !== currentProjectId);
                  if (target) go(target.id);
                }
              }}
              placeholder={t('project.searchPlaceholder')}
              className="flex-1 bg-transparent py-1 text-xs outline-none placeholder:text-neutral-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-neutral-400">{t('project.noneFound')}</div>
            ) : (
              filtered.map((p) => {
                const isCurrent = p.id === currentProjectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => go(p.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs rounded outline-none',
                      'text-neutral-700 dark:text-neutral-200',
                      'hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-800',
                    )}
                  >
                    <Check
                      size={13}
                      className={cn('shrink-0 text-neutral-500', isCurrent ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
