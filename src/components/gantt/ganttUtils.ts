import type { WorkItem } from '@/types/db';

export const DAY_WIDTH = 28;
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 56;
export const TREE_WIDTH = 280;

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function diffDays(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function isoDow(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

export interface DateRange {
  start: Date;
  end: Date;
  days: number;
}

export function computeRange(items: WorkItem[]): DateRange {
  const today = startOfDay(new Date());
  let min: Date | null = null;
  let max: Date | null = null;
  for (const w of items) {
    const s = parseDate(w.start_date);
    const e = parseDate(w.end_date);
    if (s && (!min || s < min)) min = s;
    if (e && (!max || e > max)) max = e;
  }
  if (!min) min = addDays(today, -7);
  if (!max) max = addDays(today, 30);
  min = addDays(min, -7);
  max = addDays(max, 14);
  return { start: min, end: max, days: diffDays(max, min) + 1 };
}

// Work calendar: weekly working days plus per-project non-working dates.
export interface WorkCalendar {
  weekly: Set<number>;
  nonWorking: Set<string>;
}

export function isWorkingDay(d: Date, cal: WorkCalendar): boolean {
  if (!cal.weekly.has(isoDow(d))) return false;
  if (cal.nonWorking.has(toDateString(d))) return false;
  return true;
}

export function countWorkingDays(start: Date, end: Date, cal: WorkCalendar): number {
  if (end < start) return 0;
  const total = diffDays(end, start) + 1;
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (isWorkingDay(addDays(start, i), cal)) count += 1;
  }
  return count;
}

export function formatWorkDuration(workDays: number): string {
  if (workDays <= 0) return '0d';
  if (workDays % 5 === 0) return `${workDays / 5}w`;
  return `${workDays}d`;
}

// Variable-width day axis: working days get full `dayWidth`, non-working days are
// compressed to `offWidth` so weekends/holidays take minimal horizontal space.
export interface DayAxis {
  total: number;
  days: number;
  dayWidth: number;
  offWidth: number;
  xOf: (dayIndex: number) => number;
  widthOf: (dayIndex: number) => number;
  indexAtX: (px: number) => number;
}

export function buildDayAxis(
  viewStart: Date,
  days: number,
  dayWidth: number,
  offWidth: number,
  cal: WorkCalendar,
): DayAxis {
  const offsets = new Float64Array(days + 1);
  const widths = new Float64Array(days);
  let acc = 0;
  for (let i = 0; i < days; i++) {
    offsets[i] = acc;
    const w = isWorkingDay(addDays(viewStart, i), cal) ? dayWidth : offWidth;
    widths[i] = w;
    acc += w;
  }
  offsets[days] = acc;
  return {
    total: acc,
    days,
    dayWidth,
    offWidth,
    // Days outside [0, days) fall back to full width (rarely hit; view is padded).
    xOf: (i) => {
      if (i <= 0) return i * dayWidth;
      if (i >= days) return acc + (i - days) * dayWidth;
      return offsets[i];
    },
    widthOf: (i) => (i >= 0 && i < days ? widths[i] : dayWidth),
    indexAtX: (px) => {
      if (px < 0) return Math.floor(px / dayWidth);
      if (px >= acc) return days + Math.floor((px - acc) / dayWidth);
      let lo = 0;
      let hi = days;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] <= px) lo = mid + 1;
        else hi = mid;
      }
      return lo - 1;
    },
  };
}

// Snap a date forward to the nearest working day (or stay if already working).
export function snapForward(d: Date, cal: WorkCalendar): Date {
  let cur = d;
  for (let i = 0; i < 366; i++) {
    if (isWorkingDay(cur, cal)) return cur;
    cur = addDays(cur, 1);
  }
  return d;
}

// Snap a date backward to the nearest working day (or stay if already working).
export function snapBackward(d: Date, cal: WorkCalendar): Date {
  let cur = d;
  for (let i = 0; i < 366; i++) {
    if (isWorkingDay(cur, cal)) return cur;
    cur = addDays(cur, -1);
  }
  return d;
}

export function addWorkingDays(d: Date, n: number, cal: WorkCalendar): Date {
  if (n === 0) return d;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cur = d;
  while (remaining > 0) {
    cur = addDays(cur, step);
    if (isWorkingDay(cur, cal)) remaining -= 1;
  }
  return cur;
}

// Count working-day hops walking from `from` to `to`, signed (negative if backward).
// Excludes `from`, includes `to` if it falls on a working day.
export function workingDayHops(from: Date, to: Date, cal: WorkCalendar): number {
  if (from.getTime() === to.getTime()) return 0;
  const forward = to.getTime() > from.getTime();
  const step = forward ? 1 : -1;
  let cur = from;
  let count = 0;
  const max = 365 * 50;
  for (let i = 0; i < max; i++) {
    cur = addDays(cur, step);
    if (isWorkingDay(cur, cal)) count += 1;
    if (cur.getTime() === to.getTime()) break;
    if (forward && cur > to) break;
    if (!forward && cur < to) break;
  }
  return forward ? count : -count;
}

// Build the Set<string> of all individual non-working dates from a list of ranges.
export function expandNonWorking(
  ranges: { start_date: string; end_date: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const r of ranges) {
    const s = parseDate(r.start_date);
    const e = parseDate(r.end_date);
    if (!s || !e) continue;
    const n = diffDays(e, s);
    for (let i = 0; i <= n; i++) {
      out.add(toDateString(addDays(s, i)));
    }
  }
  return out;
}

export function buildCalendar(
  workingDays: number[],
  nonWorkingRanges: { start_date: string; end_date: string }[],
): WorkCalendar {
  return {
    weekly: new Set(workingDays),
    nonWorking: expandNonWorking(nonWorkingRanges),
  };
}
