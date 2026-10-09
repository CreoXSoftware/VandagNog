// Time entries as a Clockify "Detailed report" CSV: same columns, date/time
// formats and row shape as the file Tracker → Import reads (lib/import/clockify).
//
// Round-trip: the import key is built from email, wall-clock start/end,
// project, client, task and description (baseKey in clockify.ts). Writing
// those exactly as the importer reads them means an exported file can be
// imported again without creating duplicates, and entries that came from a
// Clockify import export back under the same key they were imported with.
//
// All inputs are already access-checked upstream (RLS + the Reports filters).

import { downloadBlob } from '@/lib/download';
import type { TimeEntry } from '@/types/db';

export const CLOCKIFY_HEADERS = [
  'Project',
  'Client',
  'Description',
  'Task',
  'User',
  'Group',
  'Email',
  'Tags',
  'Billable',
  'Start Date',
  'Start Time',
  'End Date',
  'End Time',
  'Duration (h)',
  'Duration (decimal)',
  'Billable Rate (R)',
  'Billable Amount (R)',
  'Date of creation',
] as const;

export interface ClockifyExportContext {
  projectById: Map<string, { name: string; client_name: string | null }>;
  /** Work item name only (not the path): the importer matches tasks by name. */
  workItemNameById: Map<string, string>;
  personById: Map<string, { display_name: string; email: string | null }>;
}

export interface ClockifyCsv {
  csv: string;
  rows: number;
  /** Entries left out because the timer is still running (no end yet). */
  skippedRunning: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Local wall-clock, like Clockify: MM/DD/YYYY and h:mm AM/PM.
function clockifyDate(d: Date): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function clockifyTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildClockifyCsv(entries: TimeEntry[], ctx: ClockifyExportContext): ClockifyCsv {
  const finished = entries
    .filter((e) => e.end_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const lines = [CLOCKIFY_HEADERS.join(',')];
  for (const e of finished) {
    const start = new Date(e.start_at);
    const end = new Date(e.end_at!);
    // Whole minutes between the minute-truncated times, which is what the
    // importer will compute back from the Start/End columns.
    const minutes = Math.max(0, Math.floor(end.getTime() / 60000) - Math.floor(start.getTime() / 60000));
    const project = ctx.projectById.get(e.project_id);
    const person = ctx.personById.get(e.user_id);
    const task = e.work_item_id
      ? (ctx.workItemNameById.get(e.work_item_id) ?? '')
      : (e.custom_task_text ?? '');

    const row: Record<(typeof CLOCKIFY_HEADERS)[number], string> = {
      Project: project?.name ?? '',
      Client: project?.client_name ?? '',
      Description: e.notes ?? '',
      Task: task,
      User: person?.display_name ?? '',
      Group: '',
      Email: person?.email ?? '',
      Tags: '',
      Billable: '',
      'Start Date': clockifyDate(start),
      'Start Time': clockifyTime(start),
      'End Date': clockifyDate(end),
      'End Time': clockifyTime(end),
      'Duration (h)': `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
      'Duration (decimal)': (minutes / 60).toFixed(2),
      'Billable Rate (R)': '',
      'Billable Amount (R)': '',
      'Date of creation': clockifyDate(new Date(e.created_at)),
    };
    lines.push(CLOCKIFY_HEADERS.map((h) => csvField(row[h])).join(','));
  }

  return {
    // CRLF like Clockify's own export; the BOM makes Excel read UTF-8 (the
    // importer strips it).
    csv: '﻿' + lines.join('\r\n') + '\r\n',
    rows: finished.length,
    skippedRunning: entries.length - finished.length,
  };
}

export function exportClockifyCSV(
  entries: TimeEntry[],
  ctx: ClockifyExportContext,
  range: { since: string; until: string },
): ClockifyCsv {
  const out = buildClockifyCsv(entries, ctx);
  const blob = new Blob([out.csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `time-entries_${range.since}_${range.until}.csv`);
  return out;
}
