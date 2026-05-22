// Duration / time helpers for the Time Tracker.

export function durationMs(start: string, end: string | null): number {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
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
