// Tracker report exporters: CSV, Excel, PDF.
// All inputs are already access-checked upstream (RLS + filter pipeline).

import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatHM, formatHoursDecimal } from '@/lib/timeFormat';

export interface ReportRow {
  client: string;
  project: string;
  task: string;
  user: string;
  date: string;
  start: string;
  end: string;
  durationMs: number;
  notes: string;
}

export interface ReportSummary {
  totalMs: number;
  range: { since: string; until: string };
  filters: string[];
  rows: ReportRow[];
}

const HEADERS = ['Client', 'Project', 'Task', 'User', 'Date', 'Start', 'End', 'Hours', 'Duration', 'Notes'];

function rowAsArray(r: ReportRow): (string | number)[] {
  return [r.client, r.project, r.task, r.user, r.date, r.start, r.end, Number(formatHoursDecimal(r.durationMs)), formatHM(r.durationMs), r.notes];
}

function fileBase(s: ReportSummary): string {
  return `time-report_${s.range.since}_${s.range.until}`;
}

// CSV ------------------------------------------------------------------------

export function exportCSV(s: ReportSummary): void {
  const lines = [HEADERS.join(',')];
  for (const r of s.rows) lines.push(rowAsArray(r).map(csvField).join(','));
  lines.push('');
  lines.push(['', '', '', '', '', '', 'Total', Number(formatHoursDecimal(s.totalMs)), formatHM(s.totalMs), ''].map(csvField).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${fileBase(s)}.csv`);
}

function csvField(v: string | number): string {
  const str = String(v ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Excel ----------------------------------------------------------------------

export function exportExcel(s: ReportSummary): void {
  const wb = XLSX.utils.book_new();

  const data: (string | number)[][] = [HEADERS];
  for (const r of s.rows) data.push(rowAsArray(r));
  data.push([]);
  data.push(['', '', '', '', '', '', 'Total', Number(formatHoursDecimal(s.totalMs)), formatHM(s.totalMs), '']);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 18 }, { wch: 22 }, { wch: 36 }, { wch: 18 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 10 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Entries');

  // Meta sheet
  const meta: (string | number)[][] = [
    ['Time report'],
    ['Range', `${s.range.since} → ${s.range.until}`],
    ['Total hours', Number(formatHoursDecimal(s.totalMs))],
    ['Total (HM)', formatHM(s.totalMs)],
    [],
    ['Filters'],
    ...s.filters.map((f) => ['', f]),
  ];
  const metaWs = XLSX.utils.aoa_to_sheet(meta);
  metaWs['!cols'] = [{ wch: 16 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, metaWs, 'Meta');

  XLSX.writeFile(wb, `${fileBase(s)}.xlsx`);
}

// PDF ------------------------------------------------------------------------

export function exportPDF(s: ReportSummary): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(14);
  doc.text('Time report', 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Range: ${s.range.since} → ${s.range.until}`, 40, 58);
  doc.text(`Total: ${formatHM(s.totalMs)} (${formatHoursDecimal(s.totalMs)} h)`, 40, 72);
  if (s.filters.length) {
    doc.text(`Filters: ${s.filters.join('  ·  ')}`, 40, 86);
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 100,
    head: [HEADERS],
    body: s.rows.map((r) => rowAsArray(r).map(String)),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 100 },
      2: { cellWidth: 160 },
      3: { cellWidth: 80 },
      4: { cellWidth: 60 },
      5: { cellWidth: 40 },
      6: { cellWidth: 40 },
      7: { cellWidth: 40, halign: 'right' },
      8: { cellWidth: 50, halign: 'right' },
      9: { cellWidth: 'auto' },
    },
  });

  doc.save(`${fileBase(s)}.pdf`);
}

// ----------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
