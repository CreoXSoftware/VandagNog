import type { DependencyType } from '@/types/db';
import { parseDate, snapBackward, snapForward, toDateString, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { endDateFromStartAndDuration } from '@/lib/duration';

const DEP_TYPES: ReadonlySet<DependencyType> = new Set(['FS', 'FF', 'SS', 'SF'] as const);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ImportDepRef {
  id: string;
  type: DependencyType;
  lag_days: number;
}

export interface ImportTask {
  id?: string;
  name: string;
  description?: string | null;
  deliverable?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  progress?: number | null;
  /** Assignee uuid. Wins over assignee_name when both are given. */
  assignee_id?: string | null;
  /** Assignee display name, resolved against the project's members. */
  assignee_name?: string | null;
  predecessors?: ImportDepRef[];
  successors?: ImportDepRef[];
  children?: ImportTask[];
}

/** Fields a document can set on a task, for presence tracking. */
export type ImportField =
  | 'name'
  | 'description'
  | 'deliverable'
  | 'start_date'
  | 'end_date'
  | 'duration_days'
  | 'progress'
  | 'assignee';

export interface ImportDoc {
  version: number;
  tasks: ImportTask[];
}

export interface FlatTask {
  tempId: string;
  parentTempId: string | null;
  position: number;
  name: string;
  description: string | null;
  deliverable: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  progress: number;
  assignee_id: string | null;
  assignee_name: string | null;
  predecessors: ImportDepRef[];
  successors: ImportDepRef[];
  // Which fields the document actually carried. An absent field means "leave
  // this alone"; a field present-but-null means "clear it". Without this an
  // update would wipe every parent's dates, because the exporter deliberately
  // omits them (they roll up from children).
  present: Set<ImportField>;
}

export type ParseResult =
  | { ok: true; flat: FlatTask[]; taskCount: number; depCount: number }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

export function parseAndValidateImport(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, errors: ['Document must be a JSON object with a "tasks" array.'] };
  }
  if (!Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return { ok: false, errors: ['Document must contain a "tasks" array.'] };
  }
  const tasks = (parsed as { tasks: unknown[] }).tasks;
  if (tasks.length === 0) {
    return { ok: false, errors: ['"tasks" array is empty.'] };
  }

  return parseAndValidateTasks(tasks);
}

// Validates a single `tasks` array and flattens it to a DFS-ordered list where
// every parent precedes its children.
//
// Temp ids and dependency refs are scoped to this one array, so a multi-project
// document validates each project independently — two projects may reuse the
// same temp id without colliding, and a dependency can never cross projects
// (which the `deps_enforce` trigger would reject anyway).
export function parseAndValidateTasks(tasks: unknown[], pathPrefix = 'tasks'): ParseResult {
  const errors: string[] = [];
  const flat: FlatTask[] = [];
  const usedIds = new Set<string>();
  let autoCounter = 0;

  function nextAutoId(): string {
    autoCounter += 1;
    let id = `_auto_${autoCounter}`;
    while (usedIds.has(id)) {
      autoCounter += 1;
      id = `_auto_${autoCounter}`;
    }
    return id;
  }

  function walk(node: unknown, path: string, parentTempId: string | null, position: number): string | null {
    if (!isPlainObject(node)) {
      errors.push(`${path}: must be an object`);
      return null;
    }

    let id: string;
    if (node.id !== undefined) {
      if (typeof node.id !== 'string' || node.id.trim() === '') {
        errors.push(`${path}.id: must be a non-empty string`);
        id = nextAutoId();
      } else {
        id = node.id.trim();
        if (usedIds.has(id)) {
          errors.push(`${path}.id: duplicate id "${id}"`);
        }
      }
    } else {
      id = nextAutoId();
    }
    usedIds.add(id);

    if (typeof node.name !== 'string' || node.name.trim() === '') {
      errors.push(`${path}.name: required, non-empty string`);
    }
    const name = typeof node.name === 'string' ? node.name.trim() : '';

    const description = node.description == null ? null : typeof node.description === 'string' ? node.description : (errors.push(`${path}.description: must be string`), null);
    const deliverable = node.deliverable == null ? null : typeof node.deliverable === 'string' ? node.deliverable : (errors.push(`${path}.deliverable: must be string`), null);

    let start_date: string | null = null;
    if (node.start_date != null) {
      if (typeof node.start_date !== 'string' || !isValidIsoDate(node.start_date)) {
        errors.push(`${path}.start_date: must be ISO date YYYY-MM-DD`);
      } else {
        start_date = node.start_date;
      }
    }
    let end_date: string | null = null;
    if (node.end_date != null) {
      if (typeof node.end_date !== 'string' || !isValidIsoDate(node.end_date)) {
        errors.push(`${path}.end_date: must be ISO date YYYY-MM-DD`);
      } else {
        end_date = node.end_date;
      }
    }
    if (start_date && end_date && end_date < start_date) {
      errors.push(`${path}: end_date "${end_date}" is before start_date "${start_date}"`);
    }

    let duration_days: number | null = null;
    if (node.duration_days != null) {
      if (typeof node.duration_days !== 'number' || !Number.isInteger(node.duration_days) || node.duration_days <= 0) {
        errors.push(`${path}.duration_days: must be positive integer`);
      } else {
        duration_days = node.duration_days;
      }
    }

    let progress = 0;
    if (node.progress != null) {
      if (typeof node.progress !== 'number' || !Number.isFinite(node.progress) || node.progress < 0 || node.progress > 100) {
        errors.push(`${path}.progress: must be number 0-100`);
      } else {
        progress = Math.round(node.progress);
      }
    }

    let assignee_id: string | null = null;
    if (node.assignee_id != null) {
      if (typeof node.assignee_id !== 'string' || node.assignee_id.trim() === '') {
        errors.push(`${path}.assignee_id: must be a non-empty string`);
      } else {
        assignee_id = node.assignee_id.trim();
      }
    }
    let assignee_name: string | null = null;
    if (node.assignee_name != null) {
      if (typeof node.assignee_name !== 'string') {
        errors.push(`${path}.assignee_name: must be string`);
      } else if (node.assignee_name.trim() !== '') {
        assignee_name = node.assignee_name.trim();
      }
    }

    const present = new Set<ImportField>();
    if (node.name !== undefined) present.add('name');
    if (node.description !== undefined) present.add('description');
    if (node.deliverable !== undefined) present.add('deliverable');
    if (node.start_date !== undefined) present.add('start_date');
    if (node.end_date !== undefined) present.add('end_date');
    if (node.duration_days !== undefined) present.add('duration_days');
    if (node.progress !== undefined) present.add('progress');
    if (node.assignee_id !== undefined || node.assignee_name !== undefined) present.add('assignee');

    const predecessors = validateDepArray(node.predecessors, `${path}.predecessors`, errors);
    const successors = validateDepArray(node.successors, `${path}.successors`, errors);

    flat.push({
      tempId: id,
      parentTempId,
      position,
      name,
      description,
      deliverable,
      start_date,
      end_date,
      duration_days,
      progress,
      assignee_id,
      assignee_name,
      predecessors,
      successors,
      present,
    });

    if (Array.isArray(node.children)) {
      node.children.forEach((c, i) => {
        walk(c, `${path}.children[${i}]`, id, i);
      });
    }
    return id;
  }

  tasks.forEach((t, i) => {
    walk(t, `${pathPrefix}[${i}]`, null, i);
  });

  validateDepReferences(flat, errors);
  detectCycles(flat, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  let depCount = 0;
  for (const t of flat) depCount += t.predecessors.length + t.successors.length;

  return { ok: true, flat, taskCount: flat.length, depCount };
}

function validateDepArray(v: unknown, path: string, errors: string[]): ImportDepRef[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    errors.push(`${path}: must be an array`);
    return [];
  }
  const out: ImportDepRef[] = [];
  v.forEach((d, i) => {
    if (!isPlainObject(d)) {
      errors.push(`${path}[${i}]: must be an object`);
      return;
    }
    if (typeof d.id !== 'string' || d.id.trim() === '') {
      errors.push(`${path}[${i}].id: required string`);
      return;
    }
    let type: DependencyType = 'FS';
    if (d.type != null) {
      if (typeof d.type !== 'string' || !DEP_TYPES.has(d.type as DependencyType)) {
        errors.push(`${path}[${i}].type: must be one of FS, FF, SS, SF`);
      } else {
        type = d.type as DependencyType;
      }
    }
    let lag_days = 0;
    if (d.lag_days != null) {
      if (typeof d.lag_days !== 'number' || !Number.isInteger(d.lag_days)) {
        errors.push(`${path}[${i}].lag_days: must be integer`);
      } else {
        lag_days = d.lag_days;
      }
    }
    out.push({ id: d.id.trim(), type, lag_days });
  });
  return out;
}

function validateDepReferences(flat: FlatTask[], errors: string[]): void {
  const ids = new Set(flat.map((t) => t.tempId));
  for (const t of flat) {
    for (let i = 0; i < t.predecessors.length; i++) {
      const ref = t.predecessors[i];
      if (!ids.has(ref.id)) errors.push(`task "${t.tempId}".predecessors[${i}]: unknown id "${ref.id}"`);
      if (ref.id === t.tempId) errors.push(`task "${t.tempId}".predecessors[${i}]: self-reference not allowed`);
    }
    for (let i = 0; i < t.successors.length; i++) {
      const ref = t.successors[i];
      if (!ids.has(ref.id)) errors.push(`task "${t.tempId}".successors[${i}]: unknown id "${ref.id}"`);
      if (ref.id === t.tempId) errors.push(`task "${t.tempId}".successors[${i}]: self-reference not allowed`);
    }
  }
}

function detectCycles(flat: FlatTask[], errors: string[]): void {
  const adj = new Map<string, Set<string>>();
  for (const t of flat) adj.set(t.tempId, new Set());
  for (const t of flat) {
    for (const p of t.predecessors) {
      const set = adj.get(p.id);
      if (set) set.add(t.tempId);
    }
    for (const s of t.successors) {
      const set = adj.get(t.tempId);
      if (set) set.add(s.id);
    }
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const stack: { id: string; iter: Iterator<string> }[] = [];
  let cycleFound = false;
  for (const start of adj.keys()) {
    if (cycleFound) break;
    if (color.get(start) !== WHITE) continue;
    color.set(start, GRAY);
    stack.push({ id: start, iter: adj.get(start)!.values() });
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, BLACK);
        stack.pop();
        continue;
      }
      const v = next.value;
      const c = color.get(v);
      if (c === GRAY) {
        const path = stack.map((s) => s.id);
        const cycleStart = path.indexOf(v);
        const cyclePath = path.slice(cycleStart).concat(v).join(' -> ');
        errors.push(`Cyclic dependency detected: ${cyclePath}`);
        cycleFound = true;
        break;
      }
      if (c === WHITE) {
        color.set(v, GRAY);
        stack.push({ id: v, iter: adj.get(v)!.values() });
      }
    }
  }
}

export interface ImportArgs {
  projectId: string;
  flat: FlatTask[];
  calendar: WorkCalendar;
  createWorkItem: (input: {
    project_id: string;
    parent_id: string | null;
    name: string;
    description?: string | null;
    deliverable?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    duration_days?: number | null;
    progress?: number;
    position?: number;
    assignee_id?: string | null;
  }) => Promise<{ id: string }>;
  createDependency: (input: {
    project_id: string;
    predecessor_id: string;
    successor_id: string;
    type: DependencyType;
    lag_days: number;
  }) => Promise<unknown>;
  // Runs one full-project schedule on the server after all items + deps are
  // created. Replaces a per-source rescheduleFrom loop, which would reset
  // each source's dates and overwrite cascade results from earlier calls.
  rescheduleProject: () => Promise<void>;
  // Temp id -> existing work-item uuid, for tasks the caller has already matched
  // against the database. Lets a partial import attach new children to parents
  // that are already there, and wire dependencies to existing items, instead of
  // re-creating the whole tree. Entries here are never inserted.
  seedIdMap?: Map<string, string>;
  // Temp ids to leave alone entirely — e.g. tasks the caller could not match
  // unambiguously. Their descendants are skipped too, since a child whose
  // parent was never created would otherwise be inserted as a root.
  skipTempIds?: Set<string>;
  // Dependency edges already present in the database, keyed `predecessorId|successorId`.
  // Matches the unique index on (predecessor_id, successor_id), so re-importing a
  // document skips edges that are already there instead of throwing.
  existingDepKeys?: Set<string>;
}

export async function importTaskTree(args: ImportArgs): Promise<{ tasks: number; deps: number }> {
  const { projectId, flat, calendar, createWorkItem, createDependency, rescheduleProject } = args;
  const idMap = new Map<string, string>(args.seedIdMap ?? []);
  let created = 0;

  for (const t of flat) {
    // Already in the database (resolved by the caller) — don't insert a copy.
    if (args.seedIdMap?.has(t.tempId)) continue;
    if (args.skipTempIds?.has(t.tempId)) continue;
    // Parent was skipped, so this row has nowhere to attach. flat is DFS-ordered
    // (a parent always precedes its children), so an unresolved parent here can
    // only mean it was deliberately skipped — never a missing lookup.
    if (t.parentTempId && !idMap.has(t.parentTempId)) continue;
    let start = t.start_date;
    if (start) {
      const d = parseDate(start);
      if (d) start = toDateString(snapForward(d, calendar));
    }
    let end = t.end_date;
    if (end) {
      const d = parseDate(end);
      if (d) end = toDateString(snapBackward(d, calendar));
    }
    if (start && end && end < start) end = start;
    let dur: number | null = null;
    if (!end && start && t.duration_days) {
      end = endDateFromStartAndDuration(start, t.duration_days, calendar);
    } else if (!start && !end && t.duration_days) {
      dur = t.duration_days;
    }
    const parent_id = t.parentTempId ? (idMap.get(t.parentTempId) ?? null) : null;
    const row = await createWorkItem({
      project_id: projectId,
      parent_id,
      name: t.name,
      description: t.description,
      deliverable: t.deliverable,
      start_date: start,
      end_date: end,
      duration_days: dur,
      progress: t.progress,
      position: t.position,
      assignee_id: t.assignee_id,
    });
    idMap.set(t.tempId, row.id);
    created += 1;
  }

  // Edges already in the database, keyed pred|succ to match the unique index on
  // (predecessor_id, successor_id) — inserting a duplicate would throw.
  const existing = args.existingDepKeys ?? new Set<string>();
  const depKeys = new Set<string>();
  let depCount = 0;
  function recordDep(predId: string, succId: string, type: DependencyType): boolean {
    if (existing.has(`${predId}|${succId}`)) return false;
    const key = `${predId}|${succId}|${type}`;
    if (depKeys.has(key)) return false;
    depKeys.add(key);
    return true;
  }

  for (const t of flat) {
    const succId = idMap.get(t.tempId);
    if (!succId) continue;
    for (const p of t.predecessors) {
      const predId = idMap.get(p.id);
      if (!predId) continue;
      if (!recordDep(predId, succId, p.type)) continue;
      await createDependency({
        project_id: projectId,
        predecessor_id: predId,
        successor_id: succId,
        type: p.type,
        lag_days: p.lag_days,
      });
      depCount += 1;
    }
    for (const s of t.successors) {
      const succ2 = idMap.get(s.id);
      if (!succ2) continue;
      if (!recordDep(succId, succ2, s.type)) continue;
      await createDependency({
        project_id: projectId,
        predecessor_id: succId,
        successor_id: succ2,
        type: s.type,
        lag_days: s.lag_days,
      });
      depCount += 1;
    }
  }

  // One deterministic full-project schedule on the server: pre-rolls all
  // parents, enqueues every predecessor so every dep is processed, then BFS
  // to fixpoint with multi-pred binding, gating-leaf descent, and ancestor
  // rollups. Replaces a per-source loop that would revert moved sources.
  await rescheduleProject();

  return { tasks: created, deps: depCount };
}
