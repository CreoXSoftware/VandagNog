// Per-project roll-ups for the Projects list, computed from the same global
// work-item set the Tasks page loads (useTasksData), so the two pages share one
// cached fetch.

import { diffDays, parseDate } from '@/components/gantt/ganttUtils';
import { leafIds } from '@/lib/workItemTree';
import type { WorkItem } from '@/types/db';

export interface ProjectStats {
  /** Leaf tasks — summary rows only roll up their children. */
  tasks: number;
  done: number;
  /** Duration-weighted leaf progress, the same rule ProjectSummary uses. */
  progress: number;
  /** Latest task end date (YYYY-MM-DD), or null with no dated tasks. */
  finish: string | null;
  /** Latest work-item change, ISO timestamp, or null with no tasks. */
  lastActivity: string | null;
  /** Leaf tasks assigned to me, any state. */
  mine: number;
  /** ...of which not yet done. */
  mineOpen: number;
}

export const EMPTY_PROJECT_STATS: Readonly<ProjectStats> = {
  tasks: 0,
  done: 0,
  progress: 0,
  finish: null,
  lastActivity: null,
  mine: 0,
  mineOpen: 0,
};

export function projectStatsById(
  items: WorkItem[],
  me: string | null,
): Map<string, ProjectStats> {
  const leaves = leafIds(items);
  const acc = new Map<string, ProjectStats & { weight: number; weighted: number }>();

  for (const w of items) {
    let s = acc.get(w.project_id);
    if (!s) acc.set(w.project_id, (s = { ...EMPTY_PROJECT_STATS, weight: 0, weighted: 0 }));

    if (!s.lastActivity || w.updated_at > s.lastActivity) s.lastActivity = w.updated_at;
    if (w.end_date && (!s.finish || w.end_date > s.finish)) s.finish = w.end_date;
    if (!leaves.has(w.id)) continue;

    const isDone = w.progress >= 100;
    s.tasks += 1;
    if (isDone) s.done += 1;
    if (me && w.assignee_id === me) {
      s.mine += 1;
      if (!isDone) s.mineOpen += 1;
    }
    const start = parseDate(w.start_date);
    const end = parseDate(w.end_date);
    const weight = start && end ? Math.max(diffDays(end, start) + 1, 1) : 1;
    s.weight += weight;
    s.weighted += weight * w.progress;
  }

  const out = new Map<string, ProjectStats>();
  for (const [id, { weight, weighted, ...s }] of acc) {
    out.set(id, { ...s, progress: weight > 0 ? Math.round(weighted / weight) : 0 });
  }
  return out;
}
