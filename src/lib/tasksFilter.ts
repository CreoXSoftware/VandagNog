// Time filtering for the global Tasks page.
//
// Everything here is plain "YYYY-MM-DD" string comparison — lexicographic order
// matches calendar order, which is the convention used throughout the app (see
// levels.ts statusOf). Dates only become Date objects via parseDate/addDays so
// nothing ever goes through toISOString(), which would shift a day west of UTC.

import { addDays, isoDow, parseDate, toDateString } from '@/components/gantt/ganttUtils';
import type { WorkItem } from '@/types/db';

export type TimeFilter = 'today' | 'tomorrow' | 'week' | 'all';

export const TIME_FILTERS: TimeFilter[] = ['today', 'tomorrow', 'week', 'all'];

export function isTimeFilter(v: unknown): v is TimeFilter {
  return v === 'today' || v === 'tomorrow' || v === 'week' || v === 'all';
}

export interface IsoRange {
  from: string;
  to: string;
}

export function todayIso(): string {
  return toDateString(new Date());
}

// `week` runs from today to the end of the current ISO week (Sunday) rather than
// back to Monday: days already past are, by definition, overdue or done, and
// they surface in the Overdue bucket instead of padding out "this week".
export function rangeFor(when: TimeFilter, today: string): IsoRange | null {
  if (when === 'all') return null;
  const d = parseDate(today);
  if (!d) return null;
  if (when === 'today') return { from: today, to: today };
  if (when === 'tomorrow') {
    const t = toDateString(addDays(d, 1));
    return { from: t, to: t };
  }
  const toSunday = 7 - isoDow(d); // isoDow: Mon=1 … Sun=7
  return { from: today, to: toDateString(addDays(d, toSunday)) };
}

export type TaskBucket = 'overdue' | 'inRange' | 'undated' | 'done';

// Visual order of the buckets within a project group.
export const BUCKET_ORDER: TaskBucket[] = ['overdue', 'inRange', 'undated', 'done'];

// Which bucket an item falls into, or null when the time filter excludes it.
//
// "In range" is an OVERLAP test, not a due-date test: a task counts for today if
// its span contains today, which is what answers "what am I meant to be working
// on". Overdue and undated items are never hidden by the time filter — dropping
// them silently is how work gets forgotten.
export function bucketOf(
  item: Pick<WorkItem, 'progress' | 'start_date' | 'end_date'>,
  today: string,
  range: IsoRange | null,
): TaskBucket | null {
  if (item.progress >= 100) return 'done';
  if (!item.start_date || !item.end_date) return 'undated';
  if (item.end_date < today) return 'overdue';
  if (!range) return 'inRange';
  if (item.start_date <= range.to && item.end_date >= range.from) return 'inRange';
  return null;
}

// Dates for a task quick-added while a given time filter is active, so it lands
// in the list you're looking at rather than vanishing into another bucket.
//
// Always a single day, including for `week` — someone typing a name quickly
// wants one task, not one that blocks out the rest of the week. A one-day span
// on today still satisfies the week range's overlap test.
export function seedDatesFor(
  when: TimeFilter,
  today: string,
): { start_date: string | null; end_date: string | null } {
  if (when === 'all') return { start_date: null, end_date: null };
  if (when === 'tomorrow') {
    const d = parseDate(today);
    const t = d ? toDateString(addDays(d, 1)) : today;
    return { start_date: t, end_date: t };
  }
  return { start_date: today, end_date: today };
}
