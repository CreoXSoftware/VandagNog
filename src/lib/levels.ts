import type { WorkItem } from '@/types/db';

export interface LevelStyle {
  bg: string;
  text: string;
  bar: string;
  barProgress: string;
}

// Tailwind needs static class names. Palette cycles by depth.
const PALETTE: LevelStyle[] = [
  {
    bg: 'bg-purple-100 dark:bg-purple-950',
    text: 'text-purple-700 dark:text-purple-300',
    bar: 'bg-purple-500',
    barProgress: 'bg-purple-700',
  },
  {
    bg: 'bg-blue-100 dark:bg-blue-950',
    text: 'text-blue-700 dark:text-blue-300',
    bar: 'bg-blue-500',
    barProgress: 'bg-blue-700',
  },
  {
    bg: 'bg-emerald-100 dark:bg-emerald-950',
    text: 'text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    barProgress: 'bg-emerald-700',
  },
  {
    bg: 'bg-amber-100 dark:bg-amber-950',
    text: 'text-amber-800 dark:text-amber-300',
    bar: 'bg-amber-500',
    barProgress: 'bg-amber-700',
  },
  {
    bg: 'bg-sky-100 dark:bg-sky-950',
    text: 'text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-500',
    barProgress: 'bg-sky-700',
  },
  {
    bg: 'bg-pink-100 dark:bg-pink-950',
    text: 'text-pink-700 dark:text-pink-300',
    bar: 'bg-pink-500',
    barProgress: 'bg-pink-700',
  },
  {
    bg: 'bg-teal-100 dark:bg-teal-950',
    text: 'text-teal-700 dark:text-teal-300',
    bar: 'bg-teal-500',
    barProgress: 'bg-teal-700',
  },
  {
    bg: 'bg-orange-100 dark:bg-orange-950',
    text: 'text-orange-700 dark:text-orange-300',
    bar: 'bg-orange-500',
    barProgress: 'bg-orange-700',
  },
];

export function levelStyle(depth: number): LevelStyle {
  const d = Math.max(0, depth | 0);
  return PALETTE[d % PALETTE.length];
}

export function levelLabel(depth: number): string {
  return `L${(depth | 0) + 1}`;
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
