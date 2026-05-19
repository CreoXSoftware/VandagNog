import { Outlet } from '@tanstack/react-router';
import { Header } from './Header';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationsRealtime } from '@/hooks/useNotifications';

export function AppShell() {
  const { user } = useAuth();
  useNotificationsRealtime(user?.id);
  return (
    <div className="h-screen flex flex-col">
      <Header />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
