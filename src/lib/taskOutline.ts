// Outline model for the Tasks page: one project's work items flattened into the
// rows the list renders, in tree order, honouring the filter's visible set, the
// collapsed summaries, and the not-yet-saved "draft" line being typed.

import type { WorkItem } from '@/types/db';
import { siblingCompare } from '@/lib/levels';

/** Where the draft line sits among its siblings. */
export type DraftAnchor = { kind: 'first' } | { kind: 'end' } | { kind: 'after'; id: string };

/** A new task being typed — it only becomes a work item once it has a name. */
export interface DraftSpec {
  projectId: string;
  parentId: string | null;
  anchor: DraftAnchor;
}

export type OutlineRow =
  | {
      kind: 'item';
      item: WorkItem;
      depth: number;
      /** Normalised parent: null for roots and for orphans of a missing parent. */
      parentId: string | null;
      /** Has live children at all — a rollup summary, whatever the filter shows. */
      isParent: boolean;
      /** Children that pass the filter, i.e. what the chevron would reveal. */
      visibleChildren: number;
      collapsed: boolean;
    }
  | { kind: 'draft'; depth: number; parentId: string | null };

/** The id a row's parent resolves to within `byId`; orphans count as roots. */
export function parentKey(item: WorkItem, byId: Map<string, WorkItem>): string | null {
  return item.parent_id && byId.has(item.parent_id) ? item.parent_id : null;
}

export function childrenIndex(items: WorkItem[]): {
  byId: Map<string, WorkItem>;
  kids: Map<string | null, WorkItem[]>;
} {
  const byId = new Map(items.map((w) => [w.id, w]));
  const kids = new Map<string | null, WorkItem[]>();
  for (const w of items) {
    const k = parentKey(w, byId);
    const arr = kids.get(k);
    if (arr) arr.push(w);
    else kids.set(k, [w]);
  }
  for (const arr of kids.values()) arr.sort(siblingCompare);
  return { byId, kids };
}

// Matched items plus every ancestor, so a match deep in the tree is shown in
// its context rather than as a detached line.
export function withAncestors(items: WorkItem[], matched: Set<string>): Set<string> {
  const byId = new Map(items.map((w) => [w.id, w]));
  const out = new Set<string>();
  for (const id of matched) {
    let cur = byId.get(id);
    while (cur && !out.has(cur.id)) {
      out.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }
  return out;
}

export function buildOutline({
  items,
  visible,
  collapsed,
  draft,
}: {
  /** One project's live items. */
  items: WorkItem[];
  visible: Set<string>;
  collapsed: Set<string>;
  /** Only honoured when it belongs to this project. */
  draft: DraftSpec | null;
}): OutlineRow[] {
  const { kids } = childrenIndex(items);
  const out: OutlineRow[] = [];

  function walk(parent: string | null, depth: number) {
    const list = (kids.get(parent) ?? []).filter((w) => visible.has(w.id));
    const draftHere = draft && draft.parentId === parent ? draft : null;
    const pushDraft = () => out.push({ kind: 'draft', depth, parentId: parent });

    // An anchor that is not on screen (filtered out, or the optimistic row has
    // not landed yet) falls back to the end of the list.
    const anchorId = draftHere?.anchor.kind === 'after' ? draftHere.anchor.id : null;
    const afterId = anchorId && list.some((w) => w.id === anchorId) ? anchorId : null;
    if (draftHere?.anchor.kind === 'first') pushDraft();

    for (const w of list) {
      const all = kids.get(w.id) ?? [];
      const visibleChildren = all.filter((c) => visible.has(c.id)).length;
      const isCollapsed = collapsed.has(w.id);
      out.push({
        kind: 'item',
        item: w,
        depth,
        parentId: parent,
        isParent: all.length > 0,
        visibleChildren,
        collapsed: isCollapsed,
      });
      const draftInside = draft && draft.parentId === w.id;
      if (!isCollapsed && (visibleChildren > 0 || draftInside)) walk(w.id, depth + 1);
      if (afterId === w.id) pushDraft();
    }

    if (draftHere && draftHere.anchor.kind !== 'first' && !afterId) pushDraft();
  }

  walk(null, 0);
  return out;
}

/**
 * The nearest row above `index` on the same level, without leaving the
 * current parent — i.e. the sibling directly above, as the user sees it.
 */
export function previousSiblingRow(rows: OutlineRow[], index: number): OutlineRow | null {
  const depth = rows[index]?.depth;
  if (depth == null) return null;
  for (let j = index - 1; j >= 0; j--) {
    const r = rows[j];
    if (r.depth < depth) return null;
    if (r.depth === depth) return r;
  }
  return null;
}
