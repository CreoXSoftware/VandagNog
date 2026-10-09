// Reads a Clockify "detailed report" CSV export into normalised rows.
//
// Dates and times in the export are wall-clock times in the exporting user's
// timezone with no offset, so they are interpreted in the browser's timezone.
// The date order (MM/DD vs DD/MM) follows Clockify's workspace setting, so it
// is detected from the data and can be overridden when the file is ambiguous.

import { parseCsv } from './csv';

export type DateOrder = 'MDY' | 'DMY';

/**
 * Why a row cannot be imported (blocking) or deserves a second look
 * (warning). Only the blocking ones are excluded automatically.
 */
export type RowProblem =
  | 'unparsable' // blocking: date/time could not be read
  | 'zero_duration' // blocking: end is not after start
  | 'long' // warning: over LONG_ENTRY_HOURS
  | 'duration_mismatch'; // warning: start/end disagree with the reported duration

export const BLOCKING_PROBLEMS: ReadonlySet<RowProblem> = new Set(['unparsable', 'zero_duration']);
export const LONG_ENTRY_HOURS = 14;

export interface ImportRow {
  /** 0-based position among the data rows. */
  index: number;
  /** Line in the file, header being line 1 — for pointing people at the source. */
  line: number;
  /** Stable dedup key; see rowKey(). */
  key: string;
  project: string;
  client: string;
  description: string;
  task: string;
  userName: string;
  email: string;
  /** ISO instants, or null when unparsable. */
  startAt: string | null;
  endAt: string | null;
  /** Wall-clock start, "YYYY-MM-DD HH:mm", for display and keys. */
  startLocal: string | null;
  minutes: number | null;
  problems: RowProblem[];
}

export interface ParsedFile {
  rows: ImportRow[];
  dateOrder: DateOrder;
  /** False when every date in the file reads the same either way round. */
  dateOrderCertain: boolean;
  missingColumns: string[];
}

const REQUIRED = [
  'Project',
  'Client',
  'Description',
  'Task',
  'User',
  'Email',
  'Start Date',
  'Start Time',
  'End Date',
  'End Time',
] as const;

export function parseClockify(text: string, forceOrder?: DateOrder): ParsedFile {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const missingColumns = REQUIRED.filter((c) => col(c) < 0);
  if (missingColumns.length > 0) {
    return { rows: [], dateOrder: 'MDY', dateOrderCertain: true, missingColumns };
  }

  const ix = {
    project: col('Project'),
    client: col('Client'),
    description: col('Description'),
    task: col('Task'),
    user: col('User'),
    email: col('Email'),
    startDate: col('Start Date'),
    startTime: col('Start Time'),
    endDate: col('End Date'),
    endTime: col('End Time'),
    decimal: col('Duration (decimal)'),
  };

  const body = table.slice(1);
  const detected = detectDateOrder(body.flatMap((r) => [r[ix.startDate] ?? '', r[ix.endDate] ?? '']));
  const dateOrder = forceOrder ?? detected.order;

  const occurrences = new Map<string, number>();
  const rows: ImportRow[] = body.map((r, i) => {
    const get = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const start = parseDateTime(get(ix.startDate), get(ix.startTime), dateOrder);
    const end = parseDateTime(get(ix.endDate), get(ix.endTime), dateOrder);
    const problems: RowProblem[] = [];
    let minutes: number | null = null;

    if (!start || !end) problems.push('unparsable');
    else {
      minutes = Math.round((end.date.getTime() - start.date.getTime()) / 60000);
      if (minutes <= 0) problems.push('zero_duration');
      else if (minutes > LONG_ENTRY_HOURS * 60) problems.push('long');
      const reported = Number.parseFloat(get(ix.decimal));
      if (Number.isFinite(reported) && minutes > 0 && Math.abs(minutes - reported * 60) > 5) {
        problems.push('duration_mismatch');
      }
    }

    const row: Omit<ImportRow, 'key'> = {
      index: i,
      line: i + 2,
      project: get(ix.project),
      client: get(ix.client),
      description: get(ix.description),
      task: get(ix.task),
      userName: get(ix.user),
      email: get(ix.email).toLowerCase(),
      startAt: start ? start.date.toISOString() : null,
      endAt: end ? end.date.toISOString() : null,
      startLocal: start?.wall ?? null,
      minutes,
      problems,
    };
    // Identical rows (Clockify allows exact duplicates) each get their own
    // key via an occurrence counter, so both import once — and a re-import of
    // the same file maps them to the same two keys again.
    const base = baseKey(row, end?.wall ?? null, get(ix.startDate), get(ix.startTime));
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);
    return { ...row, key: hashKey(`${base}#${n}`) };
  });

  return {
    rows,
    dateOrder,
    dateOrderCertain: forceOrder ? true : detected.certain,
    missingColumns: [],
  };
}

// Built from the normalised wall-clock times rather than the raw strings, so
// changing Clockify's date/time display settings — or the importer's timezone
// — does not change the key. Unparsable rows fall back to the raw text; they
// are never imported anyway.
function baseKey(
  row: Omit<ImportRow, 'key'>,
  endWall: string | null,
  rawDate: string,
  rawTime: string,
): string {
  return [
    row.email,
    row.startLocal ?? `${rawDate} ${rawTime}`,
    endWall ?? '',
    row.project,
    row.client,
    row.task,
    row.description,
  ].join('␟');
}

function detectDateOrder(dates: string[]): { order: DateOrder; certain: boolean } {
  let mdy = false;
  let dmy = false;
  for (const d of dates) {
    const m = d.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (mdy && !dmy) return { order: 'MDY', certain: true };
  if (dmy && !mdy) return { order: 'DMY', certain: true };
  // Nothing decides it (or the file contradicts itself): Clockify's default
  // is MM/DD/YYYY, and the review lets the user flip it.
  return { order: 'MDY', certain: false };
}

function parseDateTime(
  dateStr: string,
  timeStr: string,
  order: DateOrder,
): { date: Date; wall: string } | null {
  const d = parseDatePart(dateStr, order);
  const t = parseTimePart(timeStr);
  if (!d || !t) return null;
  const date = new Date(d.y, d.m - 1, d.d, t.h, t.min, t.s);
  // Reject roll-overs such as 02/30 becoming 1 March.
  if (date.getFullYear() !== d.y || date.getMonth() !== d.m - 1 || date.getDate() !== d.d) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date, wall: `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(t.h)}:${pad(t.min)}` };
}

function parseDatePart(s: string, order: DateOrder): { y: number; m: number; d: number } | null {
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return order === 'MDY' ? { y: Number(m[3]), m: a, d: b } : { y: Number(m[3]), m: b, d: a };
}

function parseTimePart(s: string): { h: number; min: number; s: number } | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const ampm = m[4]?.toUpperCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'AM' && h === 12) h = 0;
    if (ampm === 'PM' && h !== 12) h += 12;
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return { h, min, s: sec };
}

// Two independent 53-bit hashes (cyrb53) → 28 hex chars. Collisions are not a
// practical concern at a few thousand rows, and it needs no secure context
// (crypto.subtle does), so it also works in a plain-http dev setup.
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function hashKey(s: string): string {
  return cyrb53(s, 1) + cyrb53(s, 2);
}
