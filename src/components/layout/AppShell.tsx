import { Outlet } from '@tanstack/react-router';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationsRealtime } from '@/hooks/useNotifications';
import { FloatingTimerWidget } from '@/components/tracker/FloatingTimerWidget';

export function AppShell() {
  const { user } = useAuth();
  useNotificationsRealtime(user?.id);
  return (
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
  );
}
