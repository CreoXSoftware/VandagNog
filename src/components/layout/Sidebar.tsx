import { Link, useRouterState } from '@tanstack/react-router';
import { FolderKanban, Users, Timer } from 'lucide-react';
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
  { to: '/tracker', labelKey: 'nav.tracker', icon: Timer, matchPrefix: '/tracker', disabled: true, comingSoonKey: 'nav.trackerSoon' },
];

export function Sidebar() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="w-16 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center py-3 gap-1">
      {items.map((it) => {
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
