import { Outlet } from '@tanstack/react-router';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationsRealtime } from '@/hooks/useNotifications';
import { FloatingTimerWidget } from '@/components/tracker/FloatingTimerWidget';
import { CurrentOrgProvider } from './CurrentOrgProvider';
import { useT } from '@/lib/i18n';

export function AppShell() {
  const { user } = useAuth();
  const t = useT();
  useNotificationsRealtime(user?.id);
  return (
    <CurrentOrgProvider
      loading={<div className="h-screen flex items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>}
      failed={(msg) => (
        <div className="h-screen flex flex-col items-center justify-center gap-1 text-sm text-red-600 dark:text-red-400">
          <div>{t('orgs.loadError')}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{msg}</div>
        </div>
      )}
    >
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <FloatingTimerWidget />
      </div>
    </CurrentOrgProvider>
  );
}
