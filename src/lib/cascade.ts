import { addWorkingDays, countWorkingDays, diffDays, parseDate, toDateString, workingDayHops, type WorkCalendar } from '@/components/gantt/ganttUtils';
import type { Dependency, DependencyType, WorkItem } from '@/types/db';

export type WorkItemPatch = Partial<Pick<WorkItem, 'start_date' | 'end_date' | 'progress' | 'duration_days'>>;

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

const MAX_PASSES = 5000;

// Position a successor relative to one predecessor for a given dependency type.
// Duration (in working days) is held fixed; start- or end-driven per type.
function positionFromDep(
  type: DependencyType,
  lagDays: number,
  predStart: Date,
  predEnd: Date,
  workDayDur: number,
  calendar: WorkCalendar,
): { nextStart: Date; nextEnd: Date } {
  switch (type) {
    case 'FS': {
      const nextStart = addWorkingDays(predEnd, lagDays + 1, calendar);
      return { nextStart, nextEnd: addWorkingDays(nextStart, workDayDur, calendar) };
    }
    case 'FF': {
      const nextEnd = addWorkingDays(predEnd, lagDays, calendar);
      return { nextStart: addWorkingDays(nextEnd, -workDayDur, calendar), nextEnd };
    }
    case 'SS': {
      const nextStart = addWorkingDays(predStart, lagDays, calendar);
      return { nextStart, nextEnd: addWorkingDays(nextStart, workDayDur, calendar) };
    }
    case 'SF': {
      const nextEnd = addWorkingDays(predStart, lagDays, calendar);
      return { nextStart: addWorkingDays(nextEnd, -workDayDur, calendar), nextEnd };
    }
  }
}

function workingDuration(item: WorkItem, calendar: WorkCalendar): number {
  const s = parseDate(item.start_date);
  const e = parseDate(item.end_date);
  if (s && e) return Math.max(countWorkingDays(s, e, calendar) - 1, 0);
  if (item.duration_days != null) return Math.max(item.duration_days - 1, 0);
  return 0;
}

// Binding (ASAP) position of a successor across ALL its predecessors: the latest
// required start wins. A non-gating predecessor (earlier) has no effect. Returns
// null if the successor has no predecessor with dates.
export function computeSuccessorPosition({
  successorId,
  items,
  dependencies,
  calendar,
}: {
  successorId: string;
  items: WorkItem[];
  dependencies: Dependency[];
  calendar: WorkCalendar;
}): { newStart: string; newEnd: string } | null {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const succ = itemMap.get(successorId);
  if (!succ) return null;
  const workDayDur = workingDuration(succ, calendar);

  let best: { nextStart: Date; nextEnd: Date } | null = null;
  for (const dep of dependencies) {
    if (dep.successor_id !== successorId) continue;
    const pred = itemMap.get(dep.predecessor_id);
    if (!pred) continue;
    const predStart = parseDate(pred.start_date);
    const predEnd = parseDate(pred.end_date);
    if (!predStart || !predEnd) continue;
    const pos = positionFromDep(dep.type, dep.lag_days, predStart, predEnd, workDayDur, calendar);
    if (!best || pos.nextStart.getTime() > best.nextStart.getTime()) best = pos;
  }
  if (!best) return null;
  return { newStart: toDateString(best.nextStart), newEnd: toDateString(best.nextEnd) };
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
  const incoming = new Map<string, Dependency[]>();
  for (const d of dependencies) {
    const out = outgoing.get(d.predecessor_id) ?? [];
    out.push(d);
    outgoing.set(d.predecessor_id, out);
    const inc = incoming.get(d.successor_id) ?? [];
    inc.push(d);
    incoming.set(d.successor_id, inc);
  }

  const byParent = new Map<string, string[]>();
  for (const w of itemMap.values()) {
    if (!w.parent_id || w.deleted_at) continue;
    if (!byParent.has(w.parent_id)) byParent.set(w.parent_id, []);
    byParent.get(w.parent_id)!.push(w.id);
  }

  const effective = new Map<string, WorkItem>(items.map((i) => [i.id, i]));
  const patches = new Map<string, WorkItemPatch>();

  function isLeaf(id: string): boolean {
    const kids = byParent.get(id);
    return !kids || kids.length === 0;
  }

  function applyPatch(id: string, patch: WorkItemPatch): boolean {
    const cur = effective.get(id)!;
    const next = { ...cur, ...patch };
    if (
      next.start_date === cur.start_date &&
      next.end_date === cur.end_date &&
      next.progress === cur.progress &&
      next.duration_days === cur.duration_days
    ) {
      return false;
    }
    effective.set(id, next);
    patches.set(id, { ...(patches.get(id) ?? {}), ...patch });
    return true;
  }

  function refreshParent(parentId: string): boolean {
    const childIds = byParent.get(parentId) ?? [];
    if (childIds.length === 0) return false;
    const children = childIds
      .map((id) => effective.get(id))
      .filter((c): c is WorkItem => Boolean(c) && !c!.deleted_at);
    if (children.length === 0) return false;
    const rolled = computeRollup(children);
    return applyPatch(parentId, rolled);
  }

  function propagateUpward(fromId: string, queue: string[]) {
    let cur = effective.get(fromId);
    while (cur?.parent_id) {
      const changed = refreshParent(cur.parent_id);
      if (changed) queue.push(cur.parent_id);
      cur = effective.get(cur.parent_id);
    }
  }

  function gatingChildFor(parentId: string, depType: DependencyType, side: 'pred' | 'succ'): string | null {
    const childIds = byParent.get(parentId) ?? [];
    const kids = childIds
      .map((id) => effective.get(id))
      .filter((c): c is WorkItem => Boolean(c) && !c!.deleted_at);
    if (kids.length === 0) return null;
    const usesStart = side === 'pred'
      ? depType === 'SS' || depType === 'SF'
      : depType === 'FS' || depType === 'SS';
    let best = kids[0];
    if (usesStart) {
      for (const k of kids) {
        if (k.start_date && (!best.start_date || k.start_date < best.start_date)) best = k;
      }
    } else {
      for (const k of kids) {
        if (k.end_date && (!best.end_date || k.end_date > best.end_date)) best = k;
      }
    }
    return best.id;
  }

  // Initial root patch
  applyPatch(rootId, { start_date: newStart, end_date: newEnd, duration_days: null });

  const queue: string[] = [rootId];
  propagateUpward(rootId, queue);

  let passes = 0;
  while (queue.length > 0) {
    if (++passes > MAX_PASSES) {
      return { patches: new Map(), error: 'Cascade did not converge' };
    }
    const predId = queue.shift()!;
    const edges = outgoing.get(predId) ?? [];

    // Recompute each affected successor from ALL its predecessors, not just
    // the edge that fired. The binding constraint is the latest required
    // start (ASAP): a successor waits for the latest of its predecessors.
    const recomputed = new Set<string>();
    for (const edge of edges) {
      const succId = edge.successor_id;
      if (recomputed.has(succId)) continue;
      recomputed.add(succId);

      const succ = effective.get(succId);
      if (!succ) continue;
      if (succId === rootId) {
        return { patches: new Map(), error: 'Dependency cycle detected' };
      }

      let best: { targetId: string; nextStart: Date; nextEnd: Date } | null = null;
      for (const dep of incoming.get(succId) ?? []) {
        const pred = effective.get(dep.predecessor_id);
        if (!pred) continue;
        const predStart = parseDate(pred.start_date);
        const predEnd = parseDate(pred.end_date);
        if (!predStart || !predEnd) continue;

        let targetId = succ.id;
        if (!isLeaf(succ.id)) {
          const gating = gatingChildFor(succ.id, dep.type, 'succ');
          if (!gating) continue;
          targetId = gating;
        }

        const target = effective.get(targetId)!;
        const workDayDur = workingDuration(target, calendar);
        const { nextStart, nextEnd } = positionFromDep(
          dep.type,
          dep.lag_days,
          predStart,
          predEnd,
          workDayDur,
          calendar,
        );

        if (!best || nextStart.getTime() > best.nextStart.getTime()) {
          best = { targetId, nextStart, nextEnd };
        }
      }

      if (!best) continue;
      const changed = applyPatch(best.targetId, {
        start_date: toDateString(best.nextStart),
        end_date: toDateString(best.nextEnd),
        duration_days: null,
      });
      if (changed) {
        queue.push(best.targetId);
        propagateUpward(best.targetId, queue);
      }
    }
  }

  return { patches, error: null };
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
