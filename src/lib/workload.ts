import type { WorkItem } from '@/types/db';
import { countWorkingDays, parseDate, type WorkCalendar } from '@/components/gantt/ganttUtils';

// A task placed onto a horizontal lane so that overlapping tasks stack vertically.
export interface PlacedTask {
  item: WorkItem;
  start: Date;
  end: Date;
  lane: number;
}

// Items that are NOT a parent of any other item — i.e. leaf tasks/subtasks.
// Parents roll up their children's dates, so including them would double-count.
export function leafItemIds(items: WorkItem[]): Set<string> {
  const parents = new Set<string>();
  for (const it of items) if (it.parent_id) parents.add(it.parent_id);
  const out = new Set<string>();
  for (const it of items) if (!parents.has(it.id)) out.add(it.id);
  return out;
}

// Greedy interval partitioning: pack a person's tasks into the fewest lanes such
// that no two tasks in the same lane overlap in time. More lanes used = more
// concurrent work = higher load, which is the visual signal of "scheduled spans".
export function packLanes(tasks: WorkItem[]): { placed: PlacedTask[]; laneCount: number } {
  const dated = tasks
    .map((item) => {
      const start = parseDate(item.start_date);
      const end = parseDate(item.end_date);
      if (!start || !end || end < start) return null;
      return { item, start, end };
    })
    .filter((x): x is { item: WorkItem; start: Date; end: Date } => x !== null)
    .sort(
      (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
    );

  const laneEnd: number[] = []; // end-time (ms) of the last task in each lane
  const placed: PlacedTask[] = [];
  for (const t of dated) {
    let lane = -1;
    for (let i = 0; i < laneEnd.length; i++) {
      if (laneEnd[i] < t.start.getTime()) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(t.end.getTime());
    } else {
      laneEnd[lane] = t.end.getTime();
    }
    placed.push({ item: t.item, start: t.start, end: t.end, lane });
  }
  return { placed, laneCount: Math.max(1, laneEnd.length) };
}

// Sum of each task's own working-day span (committed task-days). Tasks may overlap,
// so this is total committed effort, not distinct busy calendar days.
export function totalWorkingDays(placed: PlacedTask[], cal: WorkCalendar): number {
  let sum = 0;
  for (const p of placed) sum += countWorkingDays(p.start, p.end, cal);
  return sum;
}

// A person's tasks for a single project, lane-packed independently.
export interface ProjectLane {
  projectId: string;
  placed: PlacedTask[];
  laneCount: number;
  workDays: number;
}

// Group a person's tasks by project, lane-pack each project independently.
export function packByProject(tasks: WorkItem[], cal: WorkCalendar): ProjectLane[] {
  const byProject = new Map<string, WorkItem[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.project_id);
    if (arr) arr.push(t);
    else byProject.set(t.project_id, [t]);
  }
  const out: ProjectLane[] = [];
  for (const [projectId, items] of byProject) {
    const { placed, laneCount } = packLanes(items);
    out.push({ projectId, placed, laneCount, workDays: totalWorkingDays(placed, cal) });
  }
  return out;
}
