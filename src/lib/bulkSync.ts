// JSON reconciliation for the Tasks page and the project Quick Add panel: match
// an import document against what is already in the database, so a file can be
// re-imported without duplicating everything, edited entries update in place,
// and items missing from the file can be pruned.
//
// Nothing in the app did this before. importTaskTree always inserted fresh rows,
// which means exporting a project and re-importing the same file silently
// doubled every work item — the uuid that bulkExport writes into `id` was only
// ever used as a document-local temp id.
//
// Matching is two-tier:
//   1. uuid  — `id` is a real work-item uuid that exists in the project. Exact,
//              and what makes an export -> import round trip a no-op.
//   2. path  — normalised chain of ancestor names plus own name, scoped to the
//              project. Covers hand-written and AI-generated documents, and
//              exports whose ids were stripped.
//
// There is no unique constraint to lean on and `name` alone is not unique, so
// path collisions are reported as ambiguous rather than guessed at: they are
// never auto-matched and never proposed for removal.

import type { WorkItem } from '@/types/db';
import type { WorkCalendar } from '@/components/gantt/ganttUtils';
import {
  importTaskTree,
  parseAndValidateTasks,
  type FlatTask,
  type ImportArgs,
} from '@/lib/bulkImport';
import { ancestorChain, collectSubtreeIds, indexById, topmostIds } from '@/lib/workItemTree';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

// \u0000 cannot appear in a task name, so it is a safe separator.
function pathKeyOf(names: string[]): string {
  return names.map(norm).join('\u0000');
}

export interface SyncPerson {
  user_id: string;
  display_name: string;
  email?: string | null;
}

// --- Parsing -----------------------------------------------------------------

export interface ParsedScope {
  /** Project uuid from a v2 document; null for a v1 document (caller chooses). */
  projectId: string | null;
  /** Project name from a v2 document, for display. */
  projectName: string | null;
  flat: FlatTask[];
}

export type SyncParseResult =
  | { ok: true; version: number; scopes: ParsedScope[] }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Accepts both document shapes:
//   v1  { version: 1, tasks: [...] }                    -> one scope, no project
//   v2  { version: 2, projects: [{ id, name, tasks }] } -> one scope per project
export function parseSyncDoc(text: string): SyncParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, errors: ['Document must be a JSON object.'] };
  }

  const version = typeof parsed.version === 'number' ? parsed.version : 1;

  // v2 — a whole workspace.
  if (Array.isArray(parsed.projects)) {
    const errors: string[] = [];
    const scopes: ParsedScope[] = [];
    parsed.projects.forEach((raw, i) => {
      if (!isPlainObject(raw)) {
        errors.push(`projects[${i}]: must be an object`);
        return;
      }
      const projectId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
      const projectName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
      if (!projectId && !projectName) {
        errors.push(`projects[${i}]: needs an "id" or a "name"`);
        return;
      }
      if (!Array.isArray(raw.tasks)) {
        errors.push(`projects[${i}].tasks: must be an array`);
        return;
      }
      // An empty project is meaningful: it says "this project has no tasks",
      // which makes every one of its rows a removal candidate.
      if (raw.tasks.length === 0) {
        scopes.push({ projectId, projectName, flat: [] });
        return;
      }
      const label = projectName ?? projectId ?? `projects[${i}]`;
      const res = parseAndValidateTasks(raw.tasks, `${label}.tasks`);
      if (!res.ok) errors.push(...res.errors);
      else scopes.push({ projectId, projectName, flat: res.flat });
    });
    if (errors.length > 0) return { ok: false, errors };
    if (scopes.length === 0) return { ok: false, errors: ['Document contains no projects.'] };
    return { ok: true, version, scopes };
  }

  // v1 — a single project's tasks, target chosen by the caller.
  if (!Array.isArray(parsed.tasks)) {
    return {
      ok: false,
      errors: ['Document must contain a "tasks" array (v1) or a "projects" array (v2).'],
    };
  }
  if (parsed.tasks.length === 0) {
    return { ok: false, errors: ['"tasks" array is empty.'] };
  }
  const res = parseAndValidateTasks(parsed.tasks);
  if (!res.ok) return { ok: false, errors: res.errors };
  return { ok: true, version, scopes: [{ projectId: null, projectName: null, flat: res.flat }] };
}

// --- Diffing -----------------------------------------------------------------

export interface SyncMatch {
  task: FlatTask;
  existing: WorkItem;
  /** Field names whose value the document changes. Empty means "identical". */
  changed: string[];
  /** The patch that would be applied. Empty when nothing changed. */
  patch: Partial<WorkItem>;
}

export interface SyncAmbiguity {
  task: FlatTask;
  candidates: WorkItem[];
}

export interface ProjectDiff {
  projectId: string;
  projectName: string;
  /** Tasks with assignees resolved to real uuids. */
  flat: FlatTask[];
  create: FlatTask[];
  /** Every matched task, changed or not. */
  matched: SyncMatch[];
  /** The subset of `matched` that would actually change something. */
  update: SyncMatch[];
  ambiguous: SyncAmbiguity[];
  remove: WorkItem[];
  /** Resolved temp id -> existing uuid, for seeding importTaskTree. */
  seedIdMap: Map<string, string>;
  /** Ambiguous tasks and their descendants — never inserted. */
  skipTempIds: Set<string>;
  /** `pred|succ` for every edge already in the project. */
  existingDepKeys: Set<string>;
}

export interface SyncDiff {
  projects: ProjectDiff[];
  /** Scopes in the file that don't correspond to a project you can see. */
  unresolved: { projectId: string | null; projectName: string | null; taskCount: number }[];
  /** Non-fatal problems, e.g. an assignee who isn't a member of the project. */
  warnings: string[];
  totals: { create: number; matched: number; update: number; remove: number; ambiguous: number };
}

export interface DiffArgs {
  scopes: ParsedScope[];
  /** Every work item visible to the user, across all projects. */
  items: WorkItem[];
  /** Every dependency edge visible to the user. */
  dependencies: { project_id: string; predecessor_id: string; successor_id: string }[];
  projects: { id: string; name: string }[];
  /** Everyone who can be an assignee, for resolving assignee_name. */
  people?: SyncPerson[];
  /** project_id -> member user_ids. An assignee outside this set is rejected. */
  membership?: Record<string, string[]>;
  /** Target project for a v1 document, which carries no project identity. */
  fallbackProjectId?: string | null;
}

export function buildSyncDiff(args: DiffArgs): SyncDiff {
  const { scopes, items, dependencies, projects, fallbackProjectId } = args;
  const people = args.people ?? [];
  const membership = args.membership ?? {};

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectByName = new Map(projects.map((p) => [norm(p.name), p]));
  const peopleById = new Map(people.map((p) => [p.user_id, p]));

  const itemsByProject = new Map<string, WorkItem[]>();
  for (const w of items) {
    const arr = itemsByProject.get(w.project_id);
    if (arr) arr.push(w);
    else itemsByProject.set(w.project_id, [w]);
  }

  const depsByProject = new Map<string, Set<string>>();
  for (const d of dependencies) {
    let set = depsByProject.get(d.project_id);
    if (!set) depsByProject.set(d.project_id, (set = new Set()));
    set.add(`${d.predecessor_id}|${d.successor_id}`);
  }

  const out: ProjectDiff[] = [];
  const unresolved: SyncDiff['unresolved'] = [];
  const warnings: string[] = [];
  const usedProjectIds = new Set<string>();

  for (const scope of scopes) {
    // Resolve the scope to a real project: explicit id, then name, then the
    // caller-supplied fallback for a v1 document.
    let project = scope.projectId ? projectById.get(scope.projectId) : undefined;
    if (!project && scope.projectName) project = projectByName.get(norm(scope.projectName));
    if (!project && !scope.projectId && !scope.projectName && fallbackProjectId) {
      project = projectById.get(fallbackProjectId);
    }
    if (!project || usedProjectIds.has(project.id)) {
      unresolved.push({
        projectId: scope.projectId,
        projectName: scope.projectName,
        taskCount: scope.flat.length,
      });
      continue;
    }
    usedProjectIds.add(project.id);

    const projectName = project.name;
    const memberIds = new Set(membership[project.id] ?? []);
    const flat = scope.flat.map((t) =>
      resolveAssignee(t, projectName, memberIds, peopleById, people, warnings),
    );

    out.push(
      diffProject({
        projectId: project.id,
        projectName,
        flat,
        existing: itemsByProject.get(project.id) ?? [],
        existingDepKeys: depsByProject.get(project.id) ?? new Set(),
      }),
    );
  }

  const totals = out.reduce(
    (acc, p) => ({
      create: acc.create + p.create.length,
      matched: acc.matched + p.matched.length,
      update: acc.update + p.update.length,
      remove: acc.remove + p.remove.length,
      ambiguous: acc.ambiguous + p.ambiguous.length,
    }),
    { create: 0, matched: 0, update: 0, remove: 0, ambiguous: 0 },
  );

  return { projects: out, unresolved, warnings, totals };
}

// Turns whatever the document said about the assignee into a real uuid.
// assignee_id wins; assignee_name is matched case-insensitively against the
// project's members. Anything unresolvable is dropped with a warning rather than
// sent to the server, where enforce_assignee_membership would abort the import.
function resolveAssignee(
  t: FlatTask,
  projectName: string,
  memberIds: Set<string>,
  peopleById: Map<string, SyncPerson>,
  people: SyncPerson[],
  warnings: string[],
): FlatTask {
  if (!t.present.has('assignee')) return t;
  const where = `${projectName} / ${t.name}`;

  const drop = (message: string): FlatTask => {
    warnings.push(message);
    const next: FlatTask = { ...t, assignee_id: null, present: new Set(t.present) };
    next.present.delete('assignee');
    return next;
  };

  if (t.assignee_id) {
    if (!memberIds.has(t.assignee_id)) {
      const who = peopleById.get(t.assignee_id)?.display_name ?? t.assignee_id;
      return drop(`${where}: "${who}" is not a member of this project — assignee left unchanged.`);
    }
    return t;
  }

  if (t.assignee_name) {
    const wanted = norm(t.assignee_name);
    const hits = people.filter((p) => memberIds.has(p.user_id) && norm(p.display_name) === wanted);
    if (hits.length === 1) return { ...t, assignee_id: hits[0].user_id };
    if (hits.length === 0) {
      return drop(`${where}: no project member called "${t.assignee_name}" — assignee left unchanged.`);
    }
    return drop(`${where}: "${t.assignee_name}" matches ${hits.length} members — assignee left unchanged.`);
  }

  // Present but empty: an explicit "unassign".
  return t;
}

// Fields the rollup trigger owns on a summary row. Writing them there is
// pointless — recompute_parent overwrites the value from the children — so they
// are never part of a parent's patch.
const ROLLUP_FIELDS = new Set(['start_date', 'end_date', 'duration_days', 'progress']);

function buildPatch(
  t: FlatTask,
  existing: WorkItem,
  isParent: boolean,
): { changed: string[]; patch: Partial<WorkItem> } {
  const changed: string[] = [];
  const patch: Partial<WorkItem> = {};

  function set<K extends keyof WorkItem>(field: K, value: WorkItem[K]): void {
    if (isParent && ROLLUP_FIELDS.has(field as string)) return;
    if (existing[field] === value) return;
    patch[field] = value;
    changed.push(field as string);
  }

  // Only fields the document actually carried. An absent key means "leave this
  // alone" — without that distinction every parent would have its dates wiped,
  // because the exporter omits them on purpose.
  //
  // Names compare trimmed on both sides: the parser trims incoming names, so a
  // stored name with stray whitespace would otherwise report a phantom edit on
  // every single round trip of an untouched file.
  if (t.present.has('name') && t.name && t.name !== existing.name.trim()) {
    set('name', t.name);
  }
  if (t.present.has('description')) set('description', t.description);
  if (t.present.has('deliverable')) set('deliverable', t.deliverable);
  if (t.present.has('start_date')) set('start_date', t.start_date);
  if (t.present.has('end_date')) set('end_date', t.end_date);
  if (t.present.has('duration_days')) set('duration_days', t.duration_days);
  if (t.present.has('progress')) set('progress', t.progress);
  if (t.present.has('assignee')) set('assignee_id', t.assignee_id);

  return { changed, patch };
}

function diffProject(a: {
  projectId: string;
  projectName: string;
  flat: FlatTask[];
  existing: WorkItem[];
  existingDepKeys: Set<string>;
}): ProjectDiff {
  const { projectId, projectName, flat, existing, existingDepKeys } = a;

  const byId = indexById(existing);
  const parentIds = new Set<string>();
  for (const w of existing) if (w.parent_id) parentIds.add(w.parent_id);

  // Path key -> existing items. Arrays, so sibling name collisions are visible.
  const byPath = new Map<string, WorkItem[]>();
  for (const w of existing) {
    const names = [...ancestorChain(byId, w).map((p) => p.name), w.name];
    const key = pathKeyOf(names);
    const arr = byPath.get(key);
    if (arr) arr.push(w);
    else byPath.set(key, [w]);
  }

  // Path key for each task in the document, built from the document's own tree.
  const flatById = new Map(flat.map((t) => [t.tempId, t]));
  const docPath = new Map<string, string>();
  for (const t of flat) {
    const names: string[] = [t.name];
    const seen = new Set<string>([t.tempId]);
    let parent = t.parentTempId;
    while (parent && !seen.has(parent)) {
      const p = flatById.get(parent);
      if (!p) break;
      names.unshift(p.name);
      seen.add(parent);
      parent = p.parentTempId;
    }
    docPath.set(t.tempId, pathKeyOf(names));
  }

  const consumed = new Set<string>();
  const hitByTemp = new Map<string, WorkItem>();
  const ambiguousByTemp = new Map<string, WorkItem[]>();

  // Two passes, not one. Resolving uuids first makes matching independent of
  // where a task sits in the document: otherwise a path ambiguity near the top
  // of the file could consume a row that a later task names by its exact id.
  for (const t of flat) {
    if (!UUID_RE.test(t.tempId)) continue;
    const hit = byId.get(t.tempId);
    if (!hit || consumed.has(hit.id)) continue;
    consumed.add(hit.id);
    hitByTemp.set(t.tempId, hit);
  }

  // Path keys already found to be ambiguous. Every later task on the same key is
  // ambiguous too — otherwise the first one is flagged and the second falls
  // through to "create", re-introducing the duplicate this check exists to stop.
  const ambiguousKeys = new Map<string, WorkItem[]>();

  for (const t of flat) {
    if (hitByTemp.has(t.tempId)) continue;
    const key = docPath.get(t.tempId) ?? '';

    const prior = ambiguousKeys.get(key);
    if (prior) {
      ambiguousByTemp.set(t.tempId, prior);
      continue;
    }

    const candidates = (byPath.get(key) ?? []).filter((w) => !consumed.has(w.id));
    if (candidates.length === 1) {
      consumed.add(candidates[0].id);
      hitByTemp.set(t.tempId, candidates[0]);
    } else if (candidates.length > 1) {
      // Siblings share a name and none carries an id: refuse to guess. Left
      // alone entirely — neither created nor removed.
      ambiguousKeys.set(key, candidates);
      ambiguousByTemp.set(t.tempId, candidates);
      for (const c of candidates) consumed.add(c.id);
    }
  }

  // Emit in document order so the preview reads the way the file does.
  const create: FlatTask[] = [];
  const matched: SyncMatch[] = [];
  const update: SyncMatch[] = [];
  const ambiguous: SyncAmbiguity[] = [];
  const seedIdMap = new Map<string, string>();
  // An ambiguous task is skipped, and so is everything beneath it: a child of a
  // task we refused to resolve has nowhere to attach. flat is DFS-ordered, so a
  // single forward pass propagates the exclusion down each branch.
  const skipTempIds = new Set<string>();

  for (const t of flat) {
    if (t.parentTempId && skipTempIds.has(t.parentTempId)) {
      skipTempIds.add(t.tempId);
      continue;
    }

    const hit = hitByTemp.get(t.tempId);
    if (hit) {
      seedIdMap.set(t.tempId, hit.id);
      const { changed, patch } = buildPatch(t, hit, parentIds.has(hit.id));
      const m: SyncMatch = { task: t, existing: hit, changed, patch };
      matched.push(m);
      if (changed.length > 0) update.push(m);
      continue;
    }
    const cands = ambiguousByTemp.get(t.tempId);
    if (cands) {
      ambiguous.push({ task: t, candidates: cands });
      skipTempIds.add(t.tempId);
      continue;
    }
    create.push(t);
  }

  // Never remove an ancestor of something the file kept — deleting one would
  // take its whole subtree with it (soft_delete_work_item is recursive).
  const protectedIds = new Set(consumed);
  for (const id of consumed) {
    const w = byId.get(id);
    if (!w) continue;
    for (const anc of ancestorChain(byId, w)) protectedIds.add(anc.id);
  }

  const remove = existing.filter((w) => !protectedIds.has(w.id));

  return {
    projectId,
    projectName,
    flat,
    create,
    matched,
    update,
    ambiguous,
    remove,
    seedIdMap,
    skipTempIds,
    existingDepKeys,
  };
}

// --- Applying ----------------------------------------------------------------

export interface ApplyArgs {
  diff: SyncDiff;
  applyCreate: boolean;
  applyUpdate: boolean;
  applyRemove: boolean;
  calendarFor: (projectId: string) => WorkCalendar;
  createWorkItem: ImportArgs['createWorkItem'];
  createDependency: ImportArgs['createDependency'];
  updateWorkItem: (id: string, patch: Partial<WorkItem>, projectId: string) => Promise<void>;
  deleteWorkItem: (id: string, projectId: string) => Promise<void>;
  rescheduleProject: (projectId: string) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface ApplyResult {
  created: number;
  updated: number;
  deps: number;
  removed: number;
  /** Per-item failures. The apply is not transactional, so partial success is real. */
  errors: string[];
}

// The delete RPC is recursive, so only the topmost targets are called: a
// descendant of another target would throw "Work item not found or already
// deleted". Each root accounts for every removal target beneath it.
export function removalRoots(remove: WorkItem[]): { id: string; covers: number }[] {
  const roots = topmostIds(
    remove,
    remove.map((w) => w.id),
  );
  return roots.map((id) => ({ id, covers: collectSubtreeIds(remove, id).size }));
}

export async function applySyncDiff(args: ApplyArgs): Promise<ApplyResult> {
  const { diff, applyCreate, applyUpdate, applyRemove } = args;
  const result: ApplyResult = { created: 0, updated: 0, deps: 0, removed: 0, errors: [] };

  const plan = diff.projects.map((p) => ({
    project: p,
    creates: applyCreate ? p.create.length : 0,
    updates: applyUpdate ? p.update : [],
    roots: applyRemove && p.remove.length > 0 ? removalRoots(p.remove) : [],
  }));
  const total = plan.reduce((n, s) => n + s.creates + s.updates.length + s.roots.length, 0);
  let done = 0;
  const tick = () => args.onProgress?.(++done, total);

  for (const { project: p, creates, updates, roots } of plan) {
    const willCreate = creates > 0;
    const willUpdate = updates.length > 0;
    const willRemove = roots.length > 0;
    if (!willCreate && !willUpdate && !willRemove) continue;

    // Removals first: soft_delete_work_item purges the dependencies of whatever
    // it takes, so doing it after the inserts could delete edges we just made.
    if (willRemove) {
      const byId = indexById(p.remove);
      for (const root of roots) {
        try {
          await args.deleteWorkItem(root.id, p.projectId);
          result.removed += root.covers;
        } catch (e) {
          result.errors.push(`${byId.get(root.id)?.name ?? root.id}: ${(e as Error).message}`);
        }
        tick();
      }
    }

    if (willCreate) {
      try {
        const res = await importTaskTree({
          projectId: p.projectId,
          // The full tree, so parents resolve; seedIdMap stops matched rows
          // being inserted again.
          flat: p.flat,
          calendar: args.calendarFor(p.projectId),
          createWorkItem: async (input) => {
            const row = await args.createWorkItem(input);
            tick();
            return row;
          },
          createDependency: args.createDependency,
          // Deliberately a no-op: updates still have to run, and the one
          // authoritative schedule happens once at the end of this project.
          rescheduleProject: async () => {},
          seedIdMap: p.seedIdMap,
          skipTempIds: p.skipTempIds,
          existingDepKeys: p.existingDepKeys,
        });
        result.created += res.tasks;
        result.deps += res.deps;
      } catch (e) {
        result.errors.push(`${p.projectName}: ${(e as Error).message}`);
      }
    }

    if (willUpdate) {
      for (const m of updates) {
        try {
          await args.updateWorkItem(m.existing.id, m.patch, p.projectId);
          result.updated += 1;
        } catch (e) {
          result.errors.push(`${m.existing.name}: ${(e as Error).message}`);
        }
        tick();
      }
    }

    // One settle pass per touched project, after every phase: dates may have
    // moved (updates), rows may have appeared (creates) or gone along with their
    // dependencies (removals). reschedule_project is deterministic, so running
    // it once at the end is both cheaper and more correct than per-phase calls.
    try {
      await args.rescheduleProject(p.projectId);
    } catch (e) {
      result.errors.push(`${p.projectName}: ${(e as Error).message}`);
    }
  }

  return result;
}

export type { FlatTask };
