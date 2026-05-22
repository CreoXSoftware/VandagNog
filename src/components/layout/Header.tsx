import { Link } from '@tanstack/react-router';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { signOut, useAuth } from '@/hooks/useAuth';
import { NotificationBell } from './NotificationBell';
import { Avatar } from '@/components/ui/Avatar';
import { useProfile } from '@/hooks/useProfile';
import { displayName } from '@/lib/userDisplay';
import { useTheme } from '@/lib/theme';
import { useI18n, useT, type Lang } from '@/lib/i18n';
import logoDark from '@/assets/vn_hor_dark.svg';
import logoLight from '@/assets/vn_hor_light.svg';

export function Header() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useI18n();
  const t = useT();

  const profileUser = user
    ? {
      user_id: user.id,
      email: user.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    }
    : null;

  return (
    <header className="h-16 shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex items-center px-4 gap-4">
      <Link to="/projects" className="flex items-center" aria-label={t('app.name')}>
        <img src={theme === 'dark' ? logoDark : logoLight} alt={t('app.name')} className="h-10 w-auto rounded-md" />
      </Link>
      <nav className="flex-1" />
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label={t('language.label')}
        title={t('language.label')}
        className="h-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
      >
        <option value="en">EN</option>
        <option value="af">AF</option>
      </select>
      <button
        onClick={toggle}
        aria-label={theme === 'dark' ? t('theme.toggleLight') : t('theme.toggleDark')}
        title={theme === 'dark' ? t('theme.toggleLight') : t('theme.toggleDark')}
        className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <NotificationBell />
      {profileUser && (
        <Link
          to="/profile"
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title={t('app.profileSettings')}
        >
          <Avatar user={profileUser} size="sm" />
          <span className="text-xs text-neutral-600 dark:text-neutral-400 hidden sm:block max-w-[140px] truncate">
            {displayName(profileUser)}
          </span>
        </Link>
      )}
      <Button variant="ghost" size="sm" onClick={() => signOut()}>{t('app.signOut')}</Button>
    </header>
  );
}
