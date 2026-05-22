import type { Dependency, WorkItem } from '@/types/db';
import { parseDate, toDateString } from './ganttUtils';

export type StatusFilter = 'not_started' | 'in_progress' | 'completed' | 'overdue';
export type MeFilter = 'assigned' | 'created' | null;

export interface GanttFilterState {
  assignees: string[]; // user_ids; 'unassigned' for null assignee; [] = all
  statuses: StatusFilter[]; // [] = all
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
  maxDepth: number | null; // null = no limit, else show items with level <= maxDepth
  me: MeFilter; // null = no shortcut
}

export const EMPTY_FILTER: GanttFilterState = {
  assignees: [],
  statuses: [],
  dateFrom: null,
  dateTo: null,
  maxDepth: null,
  me: null,
};

export function isFilterActive(f: GanttFilterState): boolean {
  return (
    f.assignees.length > 0 ||
    f.statuses.length > 0 ||
    f.dateFrom !== null ||
    f.dateTo !== null ||
    f.maxDepth !== null ||
    f.me !== null
  );
}

export function itemStatus(item: WorkItem, today: string): StatusFilter[] {
  const out: StatusFilter[] = [];
  if (item.progress === 0) out.push('not_started');
  else if (item.progress === 100) out.push('completed');
  else out.push('in_progress');
  if (item.end_date && item.end_date < today && item.progress < 100) out.push('overdue');
  return out;
}

interface MatchArgs {
  items: WorkItem[];
  dependencies: Dependency[];
  filter: GanttFilterState;
  currentUserId: string | null;
}

// Compute set of ids that MATCH the active filter (not including ancestors).
export function matchedIds({ items, filter, currentUserId }: MatchArgs): Set<string> {
  if (!isFilterActive(filter)) {
    const all = new Set<string>();
    for (const i of items) if (!i.deleted_at) all.add(i.id);
    return all;
  }
  const today = toDateString(new Date());
  const assigneeSet = new Set(filter.assignees);
  const statusSet = new Set(filter.statuses);
  const out = new Set<string>();

  for (const it of items) {
    if (it.deleted_at) continue;

    if (filter.maxDepth !== null && it.level > filter.maxDepth) continue;

    if (assigneeSet.size > 0) {
      const key = it.assignee_id ?? 'unassigned';
      if (!assigneeSet.has(key)) continue;
    }

    if (filter.me === 'assigned') {
      if (!currentUserId || it.assignee_id !== currentUserId) continue;
    } else if (filter.me === 'created') {
      if (!currentUserId || it.created_by !== currentUserId) continue;
    }

    if (statusSet.size > 0) {
      const st = itemStatus(it, today);
      if (!st.some((s) => statusSet.has(s))) continue;
    }

    if (filter.dateFrom || filter.dateTo) {
      const s = parseDate(it.start_date);
      const e = parseDate(it.end_date);
      if (!s || !e) continue;
      if (filter.dateFrom && it.end_date! < filter.dateFrom) continue;
      if (filter.dateTo && it.start_date! > filter.dateTo) continue;
    }

    out.add(it.id);
  }
  return out;
}

// Walk parents of matched ids, returning the set of ancestor ids (excluding matched themselves).
export function ancestorIds(items: WorkItem[], matched: Set<string>): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const out = new Set<string>();
  for (const id of matched) {
    let cur = byId.get(id);
    while (cur?.parent_id) {
      if (out.has(cur.parent_id) || matched.has(cur.parent_id)) {
        cur = byId.get(cur.parent_id);
        continue;
      }
      out.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
  }
  return out;
}
