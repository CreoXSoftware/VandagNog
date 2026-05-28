import { addWorkingDays, diffDays, parseDate, toDateString, workingDayHops, type WorkCalendar } from '@/components/gantt/ganttUtils';
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

// Earliest legal date a single dep imposes on its successor edge.
// FS/SS constrain successor START. FF/SF constrain successor END.
function constraintEdge(
  type: DependencyType,
  lagDays: number,
  predStart: Date,
  predEnd: Date,
  calendar: WorkCalendar,
): { side: 'start' | 'end'; edge: Date } {
  switch (type) {
    case 'FS': return { side: 'start', edge: addWorkingDays(predEnd, lagDays + 1, calendar) };
    case 'SS': return { side: 'start', edge: addWorkingDays(predStart, lagDays, calendar) };
    case 'FF': return { side: 'end',   edge: addWorkingDays(predEnd, lagDays, calendar) };
    case 'SF': return { side: 'end',   edge: addWorkingDays(predStart, lagDays, calendar) };
  }
}

export interface SuccessorBinding {
  startBinding: Date | null;
  endBinding: Date | null;
}

// ASAP binding for a successor: latest required start across (FS,SS) preds,
// latest required end across (FF,SF) preds. Each side independent; missing
// pred dates skipped. Null = no constraint on that side.
export function computeSuccessorBinding({
  successorId,
  items,
  dependencies,
  calendar,
}: {
  successorId: string;
  items: WorkItem[];
  dependencies: Dependency[];
  calendar: WorkCalendar;
}): SuccessorBinding {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  let startBinding: Date | null = null;
  let endBinding: Date | null = null;
  for (const dep of dependencies) {
    if (dep.successor_id !== successorId) continue;
    const pred = itemMap.get(dep.predecessor_id);
    if (!pred) continue;
    const predStart = parseDate(pred.start_date);
    const predEnd = parseDate(pred.end_date);
    if (!predStart || !predEnd) continue;
    const c = constraintEdge(dep.type, dep.lag_days, predStart, predEnd, calendar);
    if (c.side === 'start') {
      if (!startBinding || c.edge.getTime() > startBinding.getTime()) startBinding = c.edge;
    } else {
      if (!endBinding || c.edge.getTime() > endBinding.getTime()) endBinding = c.edge;
    }
  }
  return { startBinding, endBinding };
}

// Working-day shift the successor must move forward to satisfy its bindings.
// Returns 0 when satisfied or when dates are missing.
function violationShift(
  succStart: Date | null,
  succEnd: Date | null,
  binding: SuccessorBinding,
  calendar: WorkCalendar,
): number {
  if (!succStart || !succEnd) return 0;
  let startShift = 0;
  let endShift = 0;
  if (binding.startBinding && binding.startBinding.getTime() > succStart.getTime()) {
    startShift = Math.max(0, workingDayHops(succStart, binding.startBinding, calendar));
  }
  if (binding.endBinding && binding.endBinding.getTime() > succEnd.getTime()) {
    endShift = Math.max(0, workingDayHops(succEnd, binding.endBinding, calendar));
  }
  return Math.max(startShift, endShift);
}

// Convenience for callers (useDependencies): given a successor and current
// state, return the dates the successor must move to (if any).
export function computeRebindShift({
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
  const succ = items.find((i) => i.id === successorId);
  if (!succ) return null;
  const succStart = parseDate(succ.start_date);
  const succEnd = parseDate(succ.end_date);
  const binding = computeSuccessorBinding({ successorId, items, dependencies, calendar });

  // Successor missing dates: seed from binding when at least one side defined.
  if (!succStart || !succEnd) {
    if (!binding.startBinding && !binding.endBinding) return null;
    // Default duration 0 working days (single-day task) when neither stored.
    const dur = 0;
    if (binding.startBinding) {
      const ns = binding.startBinding;
      const ne = addWorkingDays(ns, dur, calendar);
      // If endBinding also given and stricter, shift forward.
      if (binding.endBinding && binding.endBinding.getTime() > ne.getTime()) {
        const extra = workingDayHops(ne, binding.endBinding, calendar);
        return {
          newStart: toDateString(addWorkingDays(ns, extra, calendar)),
          newEnd: toDateString(binding.endBinding),
        };
      }
      return { newStart: toDateString(ns), newEnd: toDateString(ne) };
    }
    // Only endBinding known.
    const ne = binding.endBinding!;
    const ns = addWorkingDays(ne, -dur, calendar);
    return { newStart: toDateString(ns), newEnd: toDateString(ne) };
  }

  const shift = violationShift(succStart, succEnd, binding, calendar);
  if (shift === 0) return null;
  return {
    newStart: toDateString(addWorkingDays(succStart, shift, calendar)),
    newEnd: toDateString(addWorkingDays(succEnd, shift, calendar)),
  };
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

  // Descend through nested summaries to the leaf that drives the rolled edge
  // for the given side: min-start leaf for 'start', max-end leaf for 'end'.
  // Ties broken by id asc (matches server).
  function gatingLeafFor(parentId: string, side: 'start' | 'end'): string | null {
    let cur = parentId;
    while (true) {
      const childIds = byParent.get(cur) ?? [];
      const kids = childIds
        .map((id) => effective.get(id))
        .filter((c): c is WorkItem => Boolean(c) && !c!.deleted_at);
      if (kids.length === 0) return cur === parentId ? null : cur;
      let best = kids[0];
      for (const k of kids) {
        if (side === 'start') {
          if (k.start_date && (!best.start_date || k.start_date < best.start_date || (k.start_date === best.start_date && k.id < best.id))) best = k;
        } else {
          if (k.end_date && (!best.end_date || k.end_date > best.end_date || (k.end_date === best.end_date && k.id < best.id))) best = k;
        }
      }
      cur = best.id;
    }
  }

  // Pre-rollup all parents bottom-up so parent-as-predecessor reads have
  // valid dates and gating-leaf descent can rank children at every level.
  // Mirrors the server reschedule_from pre-rollup pass.
  {
    let pass = 0;
    let changed = true;
    while (changed) {
      changed = false;
      if (++pass > 1000) break;
      for (const id of byParent.keys()) {
        if (refreshParent(id)) changed = true;
      }
    }
  }

  // Resolve all violations on a single successor, looping until satisfied or
  // no progress (multi-leaf summary violations converge here within one step
  // rather than requiring extra BFS rounds).
  function resolveSuccessor(succId: string, queue: string[]): boolean {
    if (succId === rootId) return false;
    let convergencePass = 0;
    let anyChange = false;
    while (convergencePass++ < 1000) {
      const succ = effective.get(succId);
      if (!succ) return anyChange;
      const binding = computeSuccessorBinding({
        successorId: succId,
        items: Array.from(effective.values()),
        dependencies,
        calendar,
      });
      const succStart = parseDate(succ.start_date);
      const succEnd = parseDate(succ.end_date);
      const shift = violationShift(succStart, succEnd, binding, calendar);
      if (shift === 0) return anyChange;

      // Decide dominant side; pick the gating leaf for that side (or succ
      // itself if it's a leaf).
      let startShift = 0;
      let endShift = 0;
      if (binding.startBinding && succStart && binding.startBinding.getTime() > succStart.getTime()) {
        startShift = Math.max(0, workingDayHops(succStart, binding.startBinding, calendar));
      }
      if (binding.endBinding && succEnd && binding.endBinding.getTime() > succEnd.getTime()) {
        endShift = Math.max(0, workingDayHops(succEnd, binding.endBinding, calendar));
      }
      const side: 'start' | 'end' = startShift >= endShift ? 'start' : 'end';

      const targetId = isLeaf(succId) ? succId : gatingLeafFor(succId, side);
      if (!targetId) return anyChange;
      const target = effective.get(targetId)!;
      const tStart = parseDate(target.start_date);
      const tEnd = parseDate(target.end_date);
      if (!tStart || !tEnd) return anyChange;

      const newTStart = addWorkingDays(tStart, shift, calendar);
      const newTEnd = addWorkingDays(tEnd, shift, calendar);
      const changed = applyPatch(targetId, {
        start_date: toDateString(newTStart),
        end_date: toDateString(newTEnd),
        duration_days: null,
      });
      if (!changed) return anyChange;
      anyChange = true;
      queue.push(targetId);
      propagateUpward(targetId, queue);
      // Loop: summary's rolled date may still violate (sibling leaf was below
      // binding); pick the new gating leaf on next pass.
    }
    return anyChange;
  }

  // Initial root patch (explicit user reposition; presumed satisfied by drag clamp).
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

    const seen = new Set<string>();
    for (const edge of edges) {
      const succId = edge.successor_id;
      if (seen.has(succId)) continue;
      seen.add(succId);
      if (succId === rootId) {
        return { patches: new Map(), error: 'Dependency cycle detected' };
      }
      resolveSuccessor(succId, queue);
    }
  }

  return { patches, error: null };
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
