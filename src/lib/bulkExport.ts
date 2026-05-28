// Export a project's work items + dependencies into the same JSON document
// format consumed by the Quick Add bulk importer (see bulkImport.ts).

import type { Dependency, WorkItem } from '@/types/db';
import type { ImportDepRef, ImportDoc, ImportTask } from '@/lib/bulkImport';

export const EXPORT_VERSION = 1;

export function buildExportDoc(workItems: WorkItem[], dependencies: Dependency[]): ImportDoc {
  const ids = new Set(workItems.map((w) => w.id));
  // Root = no parent, OR a parent that isn't in the set (e.g. a soft-deleted
  // parent). Treating orphans as roots keeps the export complete; otherwise
  // their whole subtree would silently drop out.
  const rootKey = (w: WorkItem): string | null =>
    w.parent_id && ids.has(w.parent_id) ? w.parent_id : null;

  const childrenOf = new Map<string | null, WorkItem[]>();
  for (const w of workItems) {
    const key = rootKey(w);
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(w);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.position - b.position);

  // successor id -> predecessor refs. Drop refs to items not in the set, or the
  // importer rejects the whole document with "unknown id".
  const predsOf = new Map<string, ImportDepRef[]>();
  for (const d of dependencies) {
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue;
    if (!predsOf.has(d.successor_id)) predsOf.set(d.successor_id, []);
    predsOf.get(d.successor_id)!.push({ id: d.predecessor_id, type: d.type, lag_days: d.lag_days });
  }

  function build(w: WorkItem): ImportTask {
    const kids = childrenOf.get(w.id) ?? [];
    const isParent = kids.length > 0;
    const task: ImportTask = { id: w.id, name: w.name };
    if (w.description != null && w.description !== '') task.description = w.description;
    if (w.deliverable != null && w.deliverable !== '') task.deliverable = w.deliverable;
    // Parent dates are rolled up from children on import, so omit them.
    if (!isParent) {
      if (w.start_date) task.start_date = w.start_date;
      if (w.end_date) task.end_date = w.end_date;
      if (w.duration_days != null && !w.end_date) task.duration_days = w.duration_days;
    }
    if (w.progress > 0) task.progress = w.progress;
    const preds = predsOf.get(w.id);
    if (preds && preds.length > 0) task.predecessors = preds;
    if (isParent) task.children = kids.map(build);
    return task;
  }

  return {
    version: EXPORT_VERSION,
    tasks: (childrenOf.get(null) ?? []).map(build),
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export function exportProjectJson(
  projectName: string,
  workItems: WorkItem[],
  dependencies: Dependency[],
): void {
  const doc = buildExportDoc(workItems, dependencies);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(projectName)}_${today}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
