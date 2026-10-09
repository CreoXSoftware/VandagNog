// Tree helpers shared by the global Tasks page, the JSON sync engine and the
// optimistic cache patches. All operate on a flat WorkItem[] and tolerate
// dangling parent_ids (a parent outside the set is treated as a root, matching
// how bulkExport promotes orphans).

import type { WorkItem } from '@/types/db';
import { siblingCompare } from '@/lib/levels';

export function indexById(items: WorkItem[]): Map<string, WorkItem> {
  return new Map(items.map((w) => [w.id, w]));
}

export function childrenByParent(items: WorkItem[]): Map<string, WorkItem[]> {
  const out = new Map<string, WorkItem[]>();
  for (const w of items) {
    if (!w.parent_id) continue;
    const arr = out.get(w.parent_id);
    if (arr) arr.push(w);
    else out.set(w.parent_id, [w]);
  }
  return out;
}

// The item plus every descendant. Mirrors what soft_delete_work_item does
// server-side, so the optimistic removal matches the recursive delete.
export function collectSubtreeIds(items: WorkItem[], rootId: string): Set<string> {
  const kids = childrenByParent(items);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const c of kids.get(id) ?? []) {
      if (out.has(c.id)) continue; // defensive: a cycle would otherwise hang
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

// Ancestors from the outermost root down to the immediate parent.
export function ancestorChain(byId: Map<string, WorkItem>, item: WorkItem): WorkItem[] {
  const chain: WorkItem[] = [];
  const seen = new Set<string>([item.id]);
  let cur = item.parent_id ? byId.get(item.parent_id) : undefined;
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur);
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

// Items that are not a parent of any other item. Parents roll their dates and
// progress up from their children, so they are never independently tickable.
export function leafIds(items: WorkItem[]): Set<string> {
  const parents = new Set<string>();
  for (const w of items) if (w.parent_id) parents.add(w.parent_id);
  const out = new Set<string>();
  for (const w of items) if (!parents.has(w.id)) out.add(w.id);
  return out;
}

// Reduce a removal set to its topmost members. soft_delete_work_item is
// recursive, so calling it on a child whose ancestor is also being deleted
// throws "Work item not found or already deleted".
export function topmostIds(items: WorkItem[], ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const byId = indexById(items);
  const out: string[] = [];
  for (const id of set) {
    let covered = false;
    const seen = new Set<string>([id]);
    let cur = byId.get(id)?.parent_id ?? null;
    while (cur && !seen.has(cur)) {
      if (set.has(cur)) {
        covered = true;
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
    if (!covered) out.push(id);
  }
  return out;
}

export interface ReparentUpdate {
  id: string;
  position: number;
  parent_id?: string | null;
}

// Position updates to move `draggedId` into `newParentId`, placed next to
// `targetId` (or at the end when null). placeAfter: true => after target.
// Renumbers the destination siblings on the (index + 1) * 1000 scheme and only
// returns rows whose position or parent actually changes.
export function computeReparentUpdates({
  items,
  draggedId,
  newParentId,
  targetId,
  placeAfter,
}: {
  items: WorkItem[];
  draggedId: string;
  newParentId: string | null;
  targetId: string | null;
  placeAfter: boolean;
}): ReparentUpdate[] {
  const dragged = items.find((w) => w.id === draggedId);
  if (!dragged) return [];
  const sameParent = (dragged.parent_id ?? null) === newParentId;

  const siblings = items
    .filter((w) => (w.parent_id ?? null) === newParentId && !w.deleted_at && w.id !== draggedId)
    .sort(siblingCompare);

  let insertIdx: number;
  if (targetId == null) {
    insertIdx = siblings.length;
  } else {
    const ti = siblings.findIndex((w) => w.id === targetId);
    insertIdx = ti < 0 ? siblings.length : placeAfter ? ti + 1 : ti;
  }

  const next = [...siblings];
  next.splice(insertIdx, 0, dragged);

  const updates: ReparentUpdate[] = [];
  next.forEach((w, i) => {
    const newPos = (i + 1) * 1000;
    const parentChange = w.id === draggedId && !sameParent;
    if (w.position !== newPos || parentChange) {
      const u: ReparentUpdate = { id: w.id, position: newPos };
      if (parentChange) u.parent_id = newParentId;
      updates.push(u);
    }
  });
  return updates;
}

// A position for a NEW sibling inserted at `index` among `siblings` (already in
// sibling order). Uses the integer gap when there is one; otherwise renumbers
// the siblings at and after the insertion point to open a gap, returning those
// moves alongside. position is an int column, so a fractional midpoint is not
// an option.
export function insertionPosition(
  siblings: WorkItem[],
  index: number,
): { position: number; renumber: ReparentUpdate[] } {
  const prev = index > 0 ? siblings[index - 1] : undefined;
  const next = index < siblings.length ? siblings[index] : undefined;
  if (!next) return { position: prev ? prev.position + 1000 : 1000, renumber: [] };
  const lo = prev ? prev.position : 0;
  if (next.position - lo > 1) {
    return { position: Math.floor((lo + next.position) / 2), renumber: [] };
  }
  const renumber: ReparentUpdate[] = [];
  siblings.forEach((w, i) => {
    const pos = (i < index ? i + 1 : i + 2) * 1000;
    if (w.position !== pos) renumber.push({ id: w.id, position: pos });
  });
  return { position: (index + 1) * 1000, renumber };
}
