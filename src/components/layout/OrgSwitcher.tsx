import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, ChevronDown, Network, Settings2, User } from 'lucide-react';
import { useCurrentOrg } from '@/lib/currentOrg';
import { orgRoleKey, useOrgName } from '@/lib/orgDisplay';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Top-bar picker for the current organization. Switching away from a project
// page that belongs to the old org goes to the Projects list.
export function OrgSwitcher() {
  const t = useT();
  const orgName = useOrgName();
  const { org, orgs, setOrgId } = useCurrentOrg();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  function pick(id: string) {
    setOpen(false);
    if (id === org.id) return;
    setOrgId(id);
    if (/\/projects\/[^/]+$/.test(path)) nav({ to: '/projects' });
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t('orgs.switch')}
          aria-label={t('orgs.switch')}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 rounded-md text-sm font-medium max-w-[220px] outline-none',
            'border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800',
            'data-[state=open]:bg-neutral-100 dark:data-[state=open]:bg-neutral-800',
          )}
        >
          {org.is_personal ? (
            <User size={14} className="text-neutral-500 shrink-0" />
          ) : (
            <Network size={14} className="text-neutral-500 shrink-0" />
          )}
          <span className="truncate">{orgName(org)}</span>
          {org.my_role === 'guest' && (
            <span className="shrink-0 text-[10px] font-normal text-neutral-500 dark:text-neutral-400">
              · {t('orgs.roleGuest')}
            </span>
          )}
          <ChevronDown size={13} className="opacity-50 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1 shadow-md"
        >
          <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t('orgs.title')}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs rounded outline-none',
                  'text-neutral-700 dark:text-neutral-200',
                  'hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:bg-neutral-100 dark:focus-visible:bg-neutral-800',
                )}
              >
                <Check size={13} className={cn('shrink-0 text-neutral-500', o.id === org.id ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate flex-1">{orgName(o)}</span>
                {!o.is_personal && (
                  <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                    {t(orgRoleKey[o.my_role])}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-1 pt-1 border-t border-neutral-100 dark:border-neutral-800">
            <Link
              to="/orgs"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 text-xs rounded text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Settings2 size={13} className="shrink-0 text-neutral-500" />
              {t('orgs.manage')}
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
