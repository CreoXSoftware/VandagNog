// Duration / time helpers for the Time Tracker.

import { serverNow } from './serverClock';

export function durationMs(start: string, end: string | null): number {
  const s = new Date(start).getTime();
  // A running entry was stamped by the server, so measure it in server time.
  const e = end ? new Date(end).getTime() : serverNow();
  return Math.max(0, e - s);
}

export function formatHMS(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatHM(ms: number): string {
  const total = Math.floor(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHoursDecimal(ms: number, fractionDigits = 2): string {
  return (ms / 3_600_000).toFixed(fractionDigits);
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function combineDateTime(date: string, time: string): Date {
  // date YYYY-MM-DD, time HH:MM (local)
  const [y, mo, da] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, (mo ?? 1) - 1, da ?? 1, h ?? 0, mi ?? 0, 0, 0);
}

// A session entered as one date plus start and end times. An end earlier than
// the start means it ran past midnight, so it ends on the next day.
export function sessionRange(
  date: string,
  start: string,
  end: string,
): { start: Date; end: Date; nextDay: boolean } {
  const s = combineDateTime(date, start);
  const e = combineDateTime(date, end);
  if (e >= s) return { start: s, end: e, nextDay: false };
  const next = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1, e.getHours(), e.getMinutes());
  return { start: s, end: next, nextDay: true };
}

// A typed session length, in ms: "1:30", "1.5" or "1,5" (hours), "1h30",
// "1h 30m", "2h", "90m". Null when unreadable or not positive.
export function parseDurationText(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.');
  let minutes: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) {
    minutes = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/))) {
    minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  } else if ((m = s.match(/^(\d+)\s*m(?:in)?$/))) {
    minutes = Number(m[1]);
  } else if ((m = s.match(/^\d+(?:\.\d+)?$/))) {
    minutes = Number(m[0]) * 60;
  }
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes) * 60_000;
}

// The h:mm form parseDurationText reads back.
export function formatDurationText(ms: number): string {
  const total = Math.round(ms / 60_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Calendar days between two moments' local dates (0 = same day).
export function daysApart(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86_400_000);
}

// ISO date of the Monday of the week containing d (local time).
export function weekStartIso(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0 Sun .. 6 Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + delta);
  return isoDate(x);
}

export function formatDateHuman(d: Date | string, locale?: string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatWeekLabel(weekStartIsoStr: string, locale?: string): string {
  const [y, m, d] = weekStartIsoStr.split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sm = start.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const em = end.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${sm} – ${em}`;
}
