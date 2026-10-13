import { parseDate } from '@/components/gantt/ganttUtils';

// Compact, locale-aware span. Goes through parseDate (local midnight) rather
// than new Date(iso) so the day never shifts in a negative-offset timezone.
export function formatRange(start: string | null, end: string | null, locale: string): string {
  if (!start && !end) return '—';
  const s = start ? parseDate(start) : null;
  const e = end ? parseDate(end) : null;
  const day: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (s && e) {
    if (start === end) return e.toLocaleDateString(locale, day);
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
      return `${s.getDate()}–${e.toLocaleDateString(locale, day)}`;
    }
    return `${s.toLocaleDateString(locale, day)} – ${e.toLocaleDateString(locale, day)}`;
  }
  const one = s ?? e;
  return one ? one.toLocaleDateString(locale, day) : '—';
}

// A one-line field can't hold line breaks, so a description that has them is
// edited in the details panel rather than in the Tasks outline row.
export function isMultilineDescription(description: string | null | undefined): boolean {
  return !!description && /[\r\n]/.test(description);
}
