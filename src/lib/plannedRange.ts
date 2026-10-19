import type { WorkItem } from '@/types/db';
import { parseDate, workingDayHops, type WorkCalendar } from '@/components/gantt/ganttUtils';

// A parent with a committed range keeps it while its sub-tasks move inside it;
// sub-tasks that run outside stretch the parent's effective dates past it.
// Without one the parent fits its sub-tasks (pure rollup).

type Ranged = Pick<WorkItem, 'start_date' | 'end_date' | 'planned_start' | 'planned_end'>;

export function hasPlannedRange(w: Pick<WorkItem, 'planned_start' | 'planned_end'>): boolean {
  return !!w.planned_start && !!w.planned_end;
}

// Working days the effective dates run past the committed range, per side.
export function plannedOverflow(w: Ranged, calendar: WorkCalendar): { before: number; after: number } {
  const s = parseDate(w.start_date);
  const e = parseDate(w.end_date);
  const ps = parseDate(w.planned_start);
  const pe = parseDate(w.planned_end);
  if (!s || !e || !ps || !pe) return { before: 0, after: 0 };
  return {
    before: s < ps ? workingDayHops(s, ps, calendar) : 0,
    after: e > pe ? workingDayHops(pe, e, calendar) : 0,
  };
}
