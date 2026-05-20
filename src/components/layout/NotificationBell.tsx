import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { formatDistanceToNow } from '@/lib/time';
import { useMarkAllRead, useMarkNotificationRead, useNotifications } from '@/hooks/useNotifications';
import type { AppNotification } from '@/types/db';
import { useT } from '@/lib/i18n';
import { formatNotification } from '@/lib/notificationFormat';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const unread = data.filter((n) => !n.read_at).length;
  const t = useT();
  const nav = useNavigate();

  function handleClick(n: AppNotification) {
    const view = formatNotification(n, t);
    if (!n.read_at) markRead.mutate(n.id);
    if (view.navigate) {
      nav({
        to: '/projects/$projectId',
        params: { projectId: view.navigate.projectId },
        search: {
          item: view.navigate.itemId,
          view: 'gantt',
          tab: view.navigate.tab,
        },
      });
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-300"
        aria-label={t('notifications.aria')}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-96 max-h-[28rem] overflow-y-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md shadow-lg">
            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between sticky top-0 bg-white dark:bg-neutral-900">
              <span className="text-xs font-medium">{t('notifications.title')}</span>
              {unread > 0 && (
                <button
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => markAll.mutate()}
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
            </div>
            {data.length === 0 ? (
              <div className="px-3 py-6 text-sm text-neutral-500 dark:text-neutral-400 text-center">{t('notifications.none')}</div>
            ) : (
              data.map((n) => {
                const view = formatNotification(n, t);
                const created = new Date(n.created_at);
                const clickable = !!view.navigate || !n.read_at;
                return (
                  <button
                    key={n.id}
                    onClick={() => clickable && handleClick(n)}
                    disabled={!clickable}
                    title={created.toLocaleString()}
                    className={`w-full text-left px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:hover:bg-transparent disabled:cursor-default flex gap-2 items-start ${n.read_at ? 'opacity-60' : ''}`}
                  >
                    {!n.read_at && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-neutral-800 dark:text-neutral-100 leading-snug">{view.headline}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 flex flex-wrap gap-x-1.5">
                        {view.meta.map((m, i) => (
                          <span key={i}>{i > 0 ? '· ' : ''}{m}</span>
                        ))}
                        <span>{view.meta.length > 0 ? '· ' : ''}{formatDistanceToNow(created, { addSuffix: true })}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
