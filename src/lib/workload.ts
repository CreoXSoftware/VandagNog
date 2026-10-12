import type { WorkItem } from '@/types/db';
import {
  addDays,
  countWorkingDays,
  parseDate,
  toDateString,
  type WorkCalendar,
} from '@/components/gantt/ganttUtils';

// A task placed onto a horizontal lane so that overlapping tasks stack vertically.
// An overdue task keeps occupying its lane past its planned end, up to today
// (visualEnd), so the person still reads as busy with it.
export interface PlacedTask {
  item: WorkItem;
  start: Date;
  end: Date;
  visualEnd: Date;
  lane: number;
  overdue: boolean;
  /** Working days between the planned end and today; 0 unless overdue. */
  lateDays: number;
}

// Past its end date and not finished. `today` is a YYYY-MM-DD string.
export function isOverdue(item: WorkItem, today: string): boolean {
  return !!item.end_date && item.end_date < today && item.progress < 100;
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
// Packing uses visualEnd, so an overdue tail blocks its lane through today.
export function packLanes(
  tasks: WorkItem[],
  today: Date,
  cal: WorkCalendar,
): { placed: PlacedTask[]; laneCount: number } {
  const todayStr = toDateString(today);
  const dated = tasks
    .map((item) => {
      const start = parseDate(item.start_date);
      const end = parseDate(item.end_date);
      if (!start || !end || end < start) return null;
      const late = isOverdue(item, todayStr);
      return {
        item,
        start,
        end,
        visualEnd: late ? today : end,
        overdue: late,
        lateDays: late ? countWorkingDays(addDays(end, 1), today, cal) : 0,
      };
    })
    .filter((x): x is Omit<PlacedTask, 'lane'> => x !== null)
    .sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() || a.visualEnd.getTime() - b.visualEnd.getTime(),
    );

  const laneEnd: number[] = []; // visual end-time (ms) of the last task in each lane
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
      laneEnd.push(t.visualEnd.getTime());
    } else {
      laneEnd[lane] = t.visualEnd.getTime();
    }
    placed.push({ ...t, lane });
  }
  return { placed, laneCount: Math.max(1, laneEnd.length) };
}

// Sum of each task's own planned working-day span (committed task-days). Tasks may
// overlap, so this is total committed effort, not distinct busy calendar days.
// Overdue carry-over is reported separately (ProjectLane.lateDays).
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
  overdueCount: number;
  lateDays: number;
}

// Group a person's tasks by project, lane-pack each project independently.
export function packByProject(tasks: WorkItem[], today: Date, cal: WorkCalendar): ProjectLane[] {
  const byProject = new Map<string, WorkItem[]>();
  for (const t of tasks) {
    const arr = byProject.get(t.project_id);
    if (arr) arr.push(t);
    else byProject.set(t.project_id, [t]);
  }
  const out: ProjectLane[] = [];
  for (const [projectId, items] of byProject) {
    const { placed, laneCount } = packLanes(items, today, cal);
    let overdueCount = 0;
    let lateDays = 0;
    for (const p of placed) {
      if (p.overdue) {
        overdueCount += 1;
        lateDays += p.lateDays;
      }
    }
    out.push({
      projectId,
      placed,
      laneCount,
      workDays: totalWorkingDays(placed, cal),
      overdueCount,
      lateDays,
    });
  }
  return out;
}
