import type { AppNotification, NotificationEvent } from '@/types/db';
import type { TKey } from '@/lib/i18n';
import { displayName } from '@/lib/userDisplay';

export interface NotificationView {
  headline: string;
  meta: string[];
  navigate: { projectId: string; itemId: string; tab?: 'comments' | 'details' } | null;
}

type T = (key: TKey, vars?: Record<string, string | number>) => string;

const commentEvents = new Set<NotificationEvent>(['mentioned_in_comment', 'comment_on_assigned_item']);

export function formatNotification(n: AppNotification, t: T): NotificationView {
  const actorName = n.actor ? displayName(n.actor) : null;
  const itemName = n.payload?.name || t('notifications.unknownItem');
  const projectName = n.project?.name ?? null;
  const level = typeof n.payload?.level === 'number' ? `L${n.payload.level + 1}` : null;

  const vars: Record<string, string> = {
    actor: actorName ?? t('notifications.someone'),
    name: itemName,
  };

  let headline: string;
  switch (n.event_type) {
    case 'assigned':
      headline = t(actorName ? 'notifications.events.assigned' : 'notifications.events.assigned_system', vars);
      break;
    case 'assigned_item_deleted':
      headline = t(
        actorName ? 'notifications.events.assigned_item_deleted' : 'notifications.events.assigned_item_deleted_system',
        vars,
      );
      break;
    case 'mentioned_in_comment':
      headline = t(
        actorName ? 'notifications.events.mentioned_in_comment' : 'notifications.events.mentioned_in_comment_system',
        vars,
      );
      break;
    case 'comment_on_assigned_item':
      headline = t(
        actorName
          ? 'notifications.events.comment_on_assigned_item'
          : 'notifications.events.comment_on_assigned_item_system',
        vars,
      );
      break;
    case 'predecessor_moved': {
      const predName = n.payload?.predecessor_name;
      if (predName) {
        headline = t(
          actorName ? 'notifications.events.predecessor_moved' : 'notifications.events.predecessor_moved_system',
          { ...vars, predName },
        );
      } else {
        headline = t('notifications.events.predecessor_moved_no_pred', vars);
      }
      break;
    }
    case 'invited':
      headline = t('notifications.events.invited');
      break;
    default:
      headline = String(n.event_type);
  }

  const meta: string[] = [];
  if (projectName) meta.push(projectName);
  if (level) meta.push(level);

  const navigate =
    n.project_id && n.entity_id && n.event_type !== 'assigned_item_deleted'
      ? {
          projectId: n.project_id,
          itemId: n.entity_id,
          tab: commentEvents.has(n.event_type) ? ('comments' as const) : undefined,
        }
      : null;

  return { headline, meta, navigate };
}
