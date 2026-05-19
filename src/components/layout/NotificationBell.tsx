import { useState } from 'react';
import { Bell } from 'lucide-react';
import { formatDistanceToNow } from '@/lib/time';
import { useMarkAllRead, useMarkNotificationRead, useNotifications } from '@/hooks/useNotifications';
import type { AppNotification, NotificationEvent } from '@/types/db';
import { useT, type TKey } from '@/lib/i18n';

const eventKey: Record<NotificationEvent, TKey> = {
  assigned: 'notifications.events.assigned',
  mentioned_in_comment: 'notifications.events.mentioned_in_comment',
  comment_on_assigned_item: 'notifications.events.comment_on_assigned_item',
  invited: 'notifications.events.invited',
  predecessor_moved: 'notifications.events.predecessor_moved',
  assigned_item_deleted: 'notifications.events.assigned_item_deleted',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();
  const unread = data.filter((n) => !n.read_at).length;
  const t = useT();

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
          <div className="absolute right-0 top-9 z-20 w-80 max-h-96 overflow-y-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md shadow-lg">
            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
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
              data.map((n: AppNotification) => (
                <button
                  key={n.id}
                  onClick={() => !n.read_at && markRead.mutate(n.id)}
                  className={`w-full text-left px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800 ${n.read_at ? 'opacity-60' : ''}`}
                >
                  <div className="text-xs font-medium text-neutral-800 dark:text-neutral-100">{t(eventKey[n.event_type])}</div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
