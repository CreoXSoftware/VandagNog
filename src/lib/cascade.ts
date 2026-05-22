import { addWorkingDays, countWorkingDays, diffDays, parseDate, toDateString, workingDayHops, type WorkCalendar } from '@/components/gantt/ganttUtils';
import type { Dependency, WorkItem } from '@/types/db';

export type WorkItemPatch = Partial<Pick<WorkItem, 'start_date' | 'end_date' | 'progress'>>;

export interface CascadeResult {
  patches: Map<string, WorkItemPatch>;
  error: string | null;
}

interface ComputeArgs {
  rootId: string;
  newStart: string;
  newEnd: string;
  items: WorkItem[];
  dependencies: Dependency[];
  calendar: WorkCalendar;
}

export function computeCascade({
  rootId,
  newStart,
  newEnd,
  items,
  dependencies,
  calendar,
}: ComputeArgs): CascadeResult {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  if (!itemMap.has(rootId)) return { patches: new Map(), error: 'Work item not found' };

  const outgoing = new Map<string, Dependency[]>();
  for (const d of dependencies) {
    const arr = outgoing.get(d.predecessor_id) ?? [];
    arr.push(d);
    outgoing.set(d.predecessor_id, arr);
  }

  // Effective state: clone of items with patches applied as we go.
  const effective = new Map<string, WorkItem>(items.map((i) => [i.id, i]));
  const patches = new Map<string, WorkItemPatch>();

  function applyLeafPatch(id: string, start: string, end: string) {
    const cur = effective.get(id)!;
    if (cur.start_date === start && cur.end_date === end) return false;
    effective.set(id, { ...cur, start_date: start, end_date: end });
    const existing = patches.get(id) ?? {};
    patches.set(id, { ...existing, start_date: start, end_date: end });
    return true;
  }

  applyLeafPatch(rootId, newStart, newEnd);

  // BFS forward cascade. Bidirectional: successors snap exactly to constraint.
  const queue: string[] = [rootId];
  const visited = new Set<string>([rootId]);

  while (queue.length > 0) {
    const predId = queue.shift()!;
    const pred = effective.get(predId)!;
    const edges = outgoing.get(predId) ?? [];

    for (const dep of edges) {
      const succ = effective.get(dep.successor_id);
      if (!succ) continue;
      if (dep.successor_id === rootId) {
        return { patches: new Map(), error: 'Dependency cycle detected' };
      }

      const predStart = parseDate(pred.start_date);
      const predEnd = parseDate(pred.end_date);
      if (!predStart || !predEnd) continue;

      const succStartCur = parseDate(succ.start_date);
      const succEndCur = parseDate(succ.end_date);
      const workDayDur = succStartCur && succEndCur
        ? Math.max(countWorkingDays(succStartCur, succEndCur, calendar) - 1, 0)
        : 0;

      let nextStart: Date;
      let nextEnd: Date;
      switch (dep.type) {
        case 'FS':
          nextStart = addWorkingDays(predEnd, dep.lag_days + 1, calendar);
          nextEnd = addWorkingDays(nextStart, workDayDur, calendar);
          break;
        case 'FF':
          nextEnd = addWorkingDays(predEnd, dep.lag_days, calendar);
          nextStart = addWorkingDays(nextEnd, -workDayDur, calendar);
          break;
        case 'SS':
          nextStart = addWorkingDays(predStart, dep.lag_days, calendar);
          nextEnd = addWorkingDays(nextStart, workDayDur, calendar);
          break;
        case 'SF':
          nextEnd = addWorkingDays(predStart, dep.lag_days, calendar);
          nextStart = addWorkingDays(nextEnd, -workDayDur, calendar);
          break;
      }

      const newStartStr = toDateString(nextStart);
      const newEndStr = toDateString(nextEnd);

      const changed = applyLeafPatch(succ.id, newStartStr, newEndStr);
      if (changed && !visited.has(succ.id)) {
        visited.add(succ.id);
        queue.push(succ.id);
      } else if (changed) {
        // already visited but dates changed again — re-enqueue to propagate
        queue.push(succ.id);
      }
    }
  }

  // Parent rollup: bottom-up recompute for ancestors of any patched leaf.
  applyParentRollup(effective, patches);

  return { patches, error: null };
}

function applyParentRollup(
  effective: Map<string, WorkItem>,
  patches: Map<string, WorkItemPatch>,
) {
  // Children ids by parent id. Resolve to WorkItem via `effective` at rollup
  // time so updates from earlier rollups (e.g. task) are visible to later
  // ancestors (e.g. epic).
  const byParent = new Map<string, string[]>();
  for (const w of effective.values()) {
    if (!w.parent_id || w.deleted_at) continue;
    if (!byParent.has(w.parent_id)) byParent.set(w.parent_id, []);
    byParent.get(w.parent_id)!.push(w.id);
  }

  // Ancestors of any patched leaf, ordered deepest first (subtask < task < epic).
  const ancestors = new Set<string>();
  for (const id of patches.keys()) {
    let cur = effective.get(id);
    while (cur?.parent_id) {
      ancestors.add(cur.parent_id);
      cur = effective.get(cur.parent_id);
    }
  }

  const ordered = Array.from(ancestors)
    .map((id) => effective.get(id))
    .filter((w): w is WorkItem => Boolean(w))
    .sort((a, b) => b.level - a.level);

  for (const a of ordered) {
    const childIds = byParent.get(a.id) ?? [];
    if (childIds.length === 0) continue;
    const children = childIds
      .map((id) => effective.get(id))
      .filter((c): c is WorkItem => Boolean(c));
    if (children.length === 0) continue;
    const cur = effective.get(a.id) ?? a;
    const rolled = computeRollup(children);
    const changed =
      rolled.start_date !== cur.start_date ||
      rolled.end_date !== cur.end_date ||
      rolled.progress !== cur.progress;
    if (!changed) continue;
    effective.set(a.id, { ...cur, ...rolled });
    const existing = patches.get(a.id) ?? {};
    patches.set(a.id, { ...existing, ...rolled });
  }
}

// Given a (possibly modified) dependency, compute where the successor must sit
// to satisfy it, preserving the successor's current working-day duration.
export function computeSuccessorPositionFromDep(
  dep: Dependency,
  pred: WorkItem,
  succ: WorkItem,
  calendar: WorkCalendar,
): { newStart: string; newEnd: string } | null {
  const predStart = parseDate(pred.start_date);
  const predEnd = parseDate(pred.end_date);
  if (!predStart || !predEnd) return null;

  const succStartCur = parseDate(succ.start_date);
  const succEndCur = parseDate(succ.end_date);
  const workDayDur = succStartCur && succEndCur
    ? Math.max(countWorkingDays(succStartCur, succEndCur, calendar) - 1, 0)
    : 0;

  let nextStart: Date;
  let nextEnd: Date;
  switch (dep.type) {
    case 'FS':
      nextStart = addWorkingDays(predEnd, dep.lag_days + 1, calendar);
      nextEnd = addWorkingDays(nextStart, workDayDur, calendar);
      break;
    case 'FF':
      nextEnd = addWorkingDays(predEnd, dep.lag_days, calendar);
      nextStart = addWorkingDays(nextEnd, -workDayDur, calendar);
      break;
    case 'SS':
      nextStart = addWorkingDays(predStart, dep.lag_days, calendar);
      nextEnd = addWorkingDays(nextStart, workDayDur, calendar);
      break;
    case 'SF':
      nextEnd = addWorkingDays(predStart, dep.lag_days, calendar);
      nextStart = addWorkingDays(nextEnd, -workDayDur, calendar);
      break;
  }
  return { newStart: toDateString(nextStart), newEnd: toDateString(nextEnd) };
}

export interface LagUpdate {
  id: string;
  lag_days: number;
}

interface LagArgs {
  rootId: string;
  newStart: string;
  newEnd: string;
  items: WorkItem[];
  dependencies: Dependency[];
  calendar: WorkCalendar;
}

// Compute new lag_days for each dependency where the moved item is the successor,
// so the next predecessor move preserves the user-set gap.
export function computeIncomingLagUpdates({
  rootId,
  newStart,
  newEnd,
  items,
  dependencies,
  calendar,
}: LagArgs): LagUpdate[] {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const succStart = parseDate(newStart);
  const succEnd = parseDate(newEnd);
  if (!succStart || !succEnd) return [];

  const updates: LagUpdate[] = [];
  for (const dep of dependencies) {
    if (dep.successor_id !== rootId) continue;
    const pred = itemMap.get(dep.predecessor_id);
    if (!pred) continue;
    const predStart = parseDate(pred.start_date);
    const predEnd = parseDate(pred.end_date);
    if (!predStart || !predEnd) continue;

    let newLag: number;
    switch (dep.type) {
      case 'FS':
        newLag = workingDayHops(predEnd, succStart, calendar) - 1;
        break;
      case 'SS':
        newLag = workingDayHops(predStart, succStart, calendar);
        break;
      case 'FF':
        newLag = workingDayHops(predEnd, succEnd, calendar);
        break;
      case 'SF':
        newLag = workingDayHops(predStart, succEnd, calendar);
        break;
    }
    if (newLag !== dep.lag_days) {
      updates.push({ id: dep.id, lag_days: newLag });
    }
  }
  return updates;
}

function computeRollup(children: WorkItem[]): { start_date: string | null; end_date: string | null; progress: number } {
  let minStart: string | null = null;
  let maxEnd: string | null = null;
  let sumWeight = 0;
  let sumWeightedProgress = 0;
  for (const c of children) {
    if (c.deleted_at) continue;
    if (c.start_date && (!minStart || c.start_date < minStart)) minStart = c.start_date;
    if (c.end_date && (!maxEnd || c.end_date > maxEnd)) maxEnd = c.end_date;
    let weight: number;
    if (c.start_date && c.end_date) {
      const ds = parseDate(c.start_date);
      const de = parseDate(c.end_date);
      weight = ds && de ? Math.max(diffDays(de, ds) + 1, 0) : 1;
    } else {
      weight = 1;
    }
    sumWeight += weight;
    sumWeightedProgress += weight * c.progress;
  }
  const progress = sumWeight > 0 ? Math.round(sumWeightedProgress / sumWeight) : 0;
  return { start_date: minStart, end_date: maxEnd, progress };
}
