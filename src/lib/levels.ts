import type { WorkItem } from '@/types/db';

export interface LevelStyle {
  bg: string;
  text: string;
}

// Level no longer drives bar color (status does). The badge still shows "L1/L2..."
// in a neutral palette so the level text alone communicates depth.
const NEUTRAL_LEVEL_STYLE: LevelStyle = {
  bg: 'bg-neutral-100 dark:bg-neutral-800',
  text: 'text-neutral-600 dark:text-neutral-300',
};

export function levelStyle(_depth: number): LevelStyle {
  return NEUTRAL_LEVEL_STYLE;
}

export function levelLabel(depth: number): string {
  return `L${(depth | 0) + 1}`;
}

// ---- Status palette (drives bar color in the gantt) -----------------------
//
// Status is derived from progress + dates against `today`:
//   done        – progress >= 100                                       → emerald
//   overdue     – end_date  <  today AND progress < 100                 → red
//   active      – start_date <= today <= end_date AND progress < 100    → yellow
//   future      – start_date >  today AND progress < 100                → blue
//   unscheduled – missing dates                                          → neutral
//
// Bar = darker shade (uncompleted span). barProgress overlay = lighter shade
// drawn from the left, width = progress%. Two-step Tailwind difference for a
// subtle but distinct fill.

export type WorkItemStatus = 'done' | 'overdue' | 'active' | 'future' | 'unscheduled';

export interface StatusStyle {
  bar: string;
  barProgress: string;
  text: string;
}

// Vibrant palette tuned to the logo's warm orange→yellow gradient (#fc861d → #f4e23c)
// over a dark navy field. Amber on "active" echoes that gradient; emerald/red/blue
// round out a high-saturation set that reads on both light and dark backgrounds.
//   green  bar #16A34A  progress #22C55E   (emerald-600 / emerald-500)
//   red    bar #DC2626  progress #EF4444   (red-600 / red-500)
//   amber  bar #F59E0B  progress #FBBF24   (amber-500 / amber-400) — logo-tone
//   blue   bar #2563EB  progress #3B82F6   (blue-600 / blue-500)
// "done" uses a single emerald shade (fully-completed bar).
const STATUS_STYLES: Record<WorkItemStatus, StatusStyle> = {
  done:        { bar: 'bg-[#22C55E]', barProgress: 'bg-[#22C55E]', text: 'text-white' },
  overdue:     { bar: 'bg-[#DC2626]', barProgress: 'bg-[#EF4444]', text: 'text-white' },
  // Amber needs dark text — white on amber has insufficient contrast at any shade.
  active:      { bar: 'bg-[#F59E0B]', barProgress: 'bg-[#FBBF24]', text: 'text-neutral-900' },
  future:      { bar: 'bg-[#2563EB]', barProgress: 'bg-[#3B82F6]', text: 'text-white' },
  unscheduled: { bar: 'bg-neutral-600', barProgress: 'bg-neutral-400', text: 'text-white' },
};

// Day-only compare: "YYYY-MM-DD" lexicographic order matches calendar order.
export function statusOf(
  item: Pick<WorkItem, 'progress' | 'start_date' | 'end_date'>,
  todayIso: string,
): WorkItemStatus {
  if (item.progress >= 100) return 'done';
  if (!item.start_date || !item.end_date) return 'unscheduled';
  if (item.end_date < todayIso) return 'overdue';
  if (item.start_date <= todayIso) return 'active';
  return 'future';
}

export function statusStyle(status: WorkItemStatus): StatusStyle {
  return STATUS_STYLES[status];
}

// Sort siblings consistently for hierarchy display & outline numbering.
function siblingCompare(a: WorkItem, b: WorkItem): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.created_at.localeCompare(b.created_at);
}

// Outline number for every item, e.g. "1", "1.2", "1.2.3".
export function outlineNumbers(items: WorkItem[]): Map<string, string> {
  const byParent = new Map<string | null, WorkItem[]>();
  for (const it of items) {
    if (it.deleted_at) continue;
    const k = it.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  }
  for (const arr of byParent.values()) arr.sort(siblingCompare);

  const out = new Map<string, string>();
  function walk(parent: string | null, prefix: string) {
    const list = byParent.get(parent) ?? [];
    list.forEach((it, i) => {
      const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.set(it.id, num);
      walk(it.id, num);
    });
  }
  walk(null, '');
  return out;
}

export { siblingCompare };
