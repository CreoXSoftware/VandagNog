import { addWorkingDays, countWorkingDays, parseDate, toDateString } from '@/components/gantt/ganttUtils';

export function parseDurationInput(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d+)\s*([dw])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === 'w' ? n * 5 : n;
}

export function formatDurationWorkDays(workDays: number): string {
  if (workDays <= 0) return '0d';
  if (workDays % 5 === 0) return `${workDays / 5}w`;
  return `${workDays}d`;
}

export function workItemDurationLabel(
  start: string | null,
  end: string | null,
  workingDays: Set<number>,
): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s || !e) return '';
  return formatDurationWorkDays(countWorkingDays(s, e, workingDays));
}

export function endDateFromStartAndDuration(
  start: string,
  workDays: number,
  workingDays: Set<number>,
): string | null {
  const s = parseDate(start);
  if (!s) return null;
  const wd = Math.max(1, workDays);
  return toDateString(addWorkingDays(s, wd - 1, workingDays));
}
