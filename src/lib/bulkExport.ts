// Export work items + dependencies into the same JSON document format consumed
// by the bulk importer (see bulkImport.ts).
//
// Two shapes exist:
//   v1  { version: 1, tasks: [...] }                  — one project, legacy
//   v2  { version: 2, projects: [{ id, name, tasks }] } — the whole workspace
// The importer reads both; v1 documents target a single chosen project.

import type { Dependency, WorkItem } from '@/types/db';
import type { ImportDepRef, ImportDoc, ImportTask } from '@/lib/bulkImport';
import { toDateString } from '@/components/gantt/ganttUtils';
import { downloadJson, slugify } from '@/lib/download';

export const EXPORT_VERSION = 1;
export const WORKSPACE_EXPORT_VERSION = 2;

export interface ExportProjectDoc {
  id: string;
  name: string;
  tasks: ImportTask[];
}

export interface WorkspaceExportDoc {
  version: number;
  exported_at: string;
  projects: ExportProjectDoc[];
}

/** Resolves an assignee uuid to a display name for the exported document. */
export type NameResolver = (userId: string) => string | undefined;

export function buildExportDoc(
  workItems: WorkItem[],
  dependencies: Dependency[],
  nameOf?: NameResolver,
): ImportDoc {
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
    // Both, so the file is readable by a human and exact on the way back in:
    // assignee_id is authoritative, assignee_name is what you edit by hand.
    if (w.assignee_id) {
      task.assignee_id = w.assignee_id;
      const name = nameOf?.(w.assignee_id);
      if (name) task.assignee_name = name;
    }
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

// Whole-workspace export: every project the caller can see, each carrying its
// own task tree. Projects with no work items are still emitted so that a
// re-import can tell "this project is empty" from "this project wasn't in the
// file" — the difference decides whether its rows are candidates for removal.
export function buildWorkspaceExportDoc(
  projects: { id: string; name: string }[],
  workItems: WorkItem[],
  dependencies: Dependency[],
  nameOf?: NameResolver,
): WorkspaceExportDoc {
  const itemsByProject = new Map<string, WorkItem[]>();
  for (const w of workItems) {
    const arr = itemsByProject.get(w.project_id);
    if (arr) arr.push(w);
    else itemsByProject.set(w.project_id, [w]);
  }
  const depsByProject = new Map<string, Dependency[]>();
  for (const d of dependencies) {
    const arr = depsByProject.get(d.project_id);
    if (arr) arr.push(d);
    else depsByProject.set(d.project_id, [d]);
  }

  return {
    version: WORKSPACE_EXPORT_VERSION,
    exported_at: toDateString(new Date()),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      tasks: buildExportDoc(
        itemsByProject.get(p.id) ?? [],
        depsByProject.get(p.id) ?? [],
        nameOf,
      ).tasks,
    })),
  };
}

export function exportProjectJson(
  projectName: string,
  workItems: WorkItem[],
  dependencies: Dependency[],
): void {
  const doc = buildExportDoc(workItems, dependencies);
  const today = toDateString(new Date());
  downloadJson(doc, `${slugify(projectName, 'project')}_${today}.json`);
}

export function exportWorkspaceJson(
  projects: { id: string; name: string }[],
  workItems: WorkItem[],
  dependencies: Dependency[],
  nameOf?: NameResolver,
): void {
  const doc = buildWorkspaceExportDoc(projects, workItems, dependencies, nameOf);
  const today = toDateString(new Date());
  downloadJson(doc, `tasks_${today}.json`);
}
