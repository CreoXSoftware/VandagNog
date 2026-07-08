import { useEffect, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { FolderKanban, Users, Timer, ChevronLeft, ChevronRight, Building2, Gauge } from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';

interface NavItem {
  to: string;
  labelKey: TKey;
  icon: React.ComponentType<{ size?: number }>;
  matchPrefix: string;
  disabled?: boolean;
  comingSoonKey?: TKey;
}

const items: NavItem[] = [
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, matchPrefix: '/projects' },
  { to: '/teams', labelKey: 'nav.teams', icon: Users, matchPrefix: '/teams' },
  { to: '/clients', labelKey: 'nav.clients', icon: Building2, matchPrefix: '/clients' },
  { to: '/workload', labelKey: 'nav.workload', icon: Gauge, matchPrefix: '/workload' },
  { to: '/tracker', labelKey: 'nav.tracker', icon: Timer, matchPrefix: '/tracker' },
];

const STORAGE_KEY = 'vn.sidebar.collapsed';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function Sidebar() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState<boolean>(readInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <aside
      className={[
        'shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950',
        'flex flex-col items-center py-2 gap-1 transition-[width] duration-150',
        collapsed ? 'w-8' : 'w-16',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="w-6 h-6 mb-1 rounded flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {!collapsed && items.map((it) => {
        const active = path.startsWith(it.matchPrefix);
        const Icon = it.icon;
        const label = t(it.labelKey);
        const tip = it.disabled && it.comingSoonKey ? `${label} — ${t(it.comingSoonKey)}` : label;
        const cls = [
          'flex flex-col items-center justify-center w-14 h-14 rounded-md transition-colors',
          active
            ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-800 dark:hover:text-neutral-200',
          it.disabled ? 'opacity-40 cursor-not-allowed' : '',
        ].join(' ');
        const inner = (
          <>
            <Icon size={20} />
            <span className="text-[10px] mt-1 leading-none text-center px-1">{label}</span>
          </>
        );
        return it.disabled ? (
          <button key={it.to} type="button" disabled aria-label={tip} title={tip} className={cls}>
            {inner}
          </button>
        ) : (
          <Link key={it.to} to={it.to} aria-label={label} title={tip} className={cls}>
            {inner}
          </Link>
        );
      })}
    </aside>
  );
}
