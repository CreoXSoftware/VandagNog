// Tree helpers shared by the global Tasks page, the JSON sync engine and the
// optimistic cache patches. All operate on a flat WorkItem[] and tolerate
// dangling parent_ids (a parent outside the set is treated as a root, matching
// how bulkExport promotes orphans).

import type { WorkItem } from '@/types/db';

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
