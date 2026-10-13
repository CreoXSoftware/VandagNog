// Import planning: groups the parsed rows by the things that need mapping
// (projects, clients, people, tasks), proposes a decision for each, and turns
// the user's decisions into a concrete plan — what gets created, which rows
// are imported, and why every other row is not.
//
// Pure functions over plain data so the dialog stays presentational.

import type { ProjectRole } from '@/types/db';
import { BLOCKING_PROBLEMS, type ImportRow, type ParsedFile, type RowProblem } from './clockify';
import { normName, rankCandidates, similarity, SUGGEST_THRESHOLD, type Candidate } from './match';

export const IMPORT_SOURCE = 'clockify';

// ---- What we know about the workspace ---------------------------------------

export interface DirProject {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  myRole: ProjectRole | null;
  memberIds: Set<string>;
}

export interface DirPerson {
  userId: string;
  name: string;
  email: string | null;
}

export interface DirClient {
  id: string;
  name: string;
}

export interface DirWorkItem {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  position: number;
}

export interface Directory {
  me: string;
  projects: DirProject[];
  people: DirPerson[];
  clients: DirClient[];
  workItems: DirWorkItem[];
  /** The organization being imported into: new clients and projects go here. */
  orgId: string;
  /** Members of that org (not guests): they can already see every project in it. */
  orgMemberIds: Set<string>;
  /** Everyone in that org, guests too: the people I may add to my projects. */
  orgPeopleIds: Set<string>;
}

export interface ExistingEntry {
  userId: string;
  startAt: string;
  endAt: string | null;
}

export interface ExistingState {
  /** Keys from this source already in the database. */
  keys: Set<string>;
  /** Entries in the file's date window, for spotting the same session logged twice. */
  entries: ExistingEntry[];
}

export const canEdit = (p: DirProject) => p.myRole === 'owner' || p.myRole === 'editor';

// ---- Decisions -----------------------------------------------------------------

export type ProjectDecision =
  | { kind: 'existing'; projectId: string }
  | { kind: 'create'; name: string }
  | { kind: 'skip' }
  | null; // undecided

export type ClientDecision =
  | { kind: 'existing'; clientId: string }
  | { kind: 'create'; name: string }
  | { kind: 'none' }
  | null;

export type PersonDecision = { kind: 'existing'; userId: string } | { kind: 'skip' } | null;

/** What happens to a task name with no matching work item in the target project. */
export type TaskMode = 'workItem' | 'custom';

export interface Decisions {
  projects: Record<string, ProjectDecision>;
  taskMode: Record<string, TaskMode>;
  clients: Record<string, ClientDecision>;
  people: Record<string, PersonDecision>;
  /** Per-row include/exclude, overriding the default for flagged rows. */
  rowInclude: Record<number, boolean>;
  addMembers: boolean;
}

// ---- Groups ----------------------------------------------------------------------

export type MatchReason = 'exact' | 'ambiguous' | 'similar' | 'new' | 'view_only';

export interface ProjectGroup {
  key: string;
  project: string;
  client: string;
  rows: number[];
  minutes: number;
  tasks: Map<string, number>;
  exact: Candidate<DirProject>[];
  similar: Candidate<DirProject>[];
  reason: MatchReason;
}

export interface ClientGroup {
  key: string;
  name: string;
  exact: Candidate<DirClient>[];
  similar: Candidate<DirClient>[];
  reason: MatchReason;
}

export interface PersonGroup {
  key: string;
  name: string;
  email: string;
  rows: number[];
  match: DirPerson | null;
  similar: Candidate<DirPerson>[];
}

export interface Groups {
  projects: ProjectGroup[];
  clients: ClientGroup[];
  people: PersonGroup[];
}

export const projectGroupKey = (r: Pick<ImportRow, 'project' | 'client'>) =>
  `${normName(r.project)}\u0000${normName(r.client)}`;
export const clientGroupKey = (name: string) => normName(name);
export const personGroupKey = (r: Pick<ImportRow, 'email' | 'userName'>) =>
  r.email || `name:${normName(r.userName)}`;

export function buildGroups(file: ParsedFile, dir: Directory): Groups {
  const projects = new Map<string, ProjectGroup>();
  const clients = new Map<string, ClientGroup>();
  const people = new Map<string, PersonGroup>();

  for (const r of file.rows) {
    const pk = projectGroupKey(r);
    let pg = projects.get(pk);
    if (!pg) {
      pg = {
        key: pk,
        project: r.project,
        client: r.client,
        rows: [],
        minutes: 0,
        tasks: new Map(),
        exact: [],
        similar: [],
        reason: 'new',
      };
      projects.set(pk, pg);
    }
    pg.rows.push(r.index);
    pg.minutes += Math.max(0, r.minutes ?? 0);
    if (r.task) pg.tasks.set(r.task, (pg.tasks.get(r.task) ?? 0) + 1);

    if (r.client) {
      const ck = clientGroupKey(r.client);
      if (!clients.has(ck)) {
        const ranked = rankCandidates(r.client, dir.clients, (c) => c.name);
        clients.set(ck, {
          key: ck,
          name: r.client,
          ...ranked,
          reason:
            ranked.exact.length === 1
              ? 'exact'
              : ranked.exact.length > 1
                ? 'ambiguous'
                : ranked.similar.length
                  ? 'similar'
                  : 'new',
        });
      }
    }

    const uk = personGroupKey(r);
    let person = people.get(uk);
    if (!person) {
      // Only an email match is certain; a matching name is just a suggestion.
      const byEmail = r.email ? dir.people.find((p) => p.email?.toLowerCase() === r.email) : undefined;
      const ranked = byEmail ? null : rankCandidates(r.userName, dir.people, (p) => p.name);
      person = {
        key: uk,
        name: r.userName,
        email: r.email,
        rows: [],
        match: byEmail ?? null,
        similar: ranked ? [...ranked.exact, ...ranked.similar] : [],
      };
      people.set(uk, person);
    }
    person.rows.push(r.index);
  }

  for (const pg of projects.values()) {
    const ranked = rankCandidates(pg.project, dir.projects, (p) => p.name);
    // Several projects with the same name (e.g. "Topstar" and "TOPSTAR") are
    // never picked automatically — but the likeliest one (same spelling, then
    // same client) is listed first.
    const fit = (p: DirProject) =>
      (p.name.trim() === pg.project.trim() ? 2 : 0) +
      (pg.client && p.clientName && normName(p.clientName) === normName(pg.client) ? 1 : 0);
    pg.exact = [...ranked.exact].sort((a, b) => fit(b.item) - fit(a.item));
    pg.similar = ranked.similar;
    pg.reason =
      pg.exact.length === 1
        ? canEdit(pg.exact[0].item)
          ? 'exact'
          : 'view_only'
        : pg.exact.length > 1
          ? 'ambiguous'
          : ranked.similar.length
            ? 'similar'
            : 'new';
  }

  return {
    projects: [...projects.values()].sort((a, b) => b.rows.length - a.rows.length),
    clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The proposed starting point. Only certain answers are pre-filled: an exact
 * match, or "create" when nothing in the workspace resembles the name.
 * Anything ambiguous or merely similar starts undecided, so the import cannot
 * run until the user has looked at it.
 */
export function initialDecisions(groups: Groups): Decisions {
  const projects: Decisions['projects'] = {};
  const taskMode: Decisions['taskMode'] = {};
  for (const g of groups.projects) {
    taskMode[g.key] = 'workItem';
    if (!g.project.trim()) projects[g.key] = null;
    else if (g.reason === 'exact') projects[g.key] = { kind: 'existing', projectId: g.exact[0].item.id };
    else if (g.reason === 'new') projects[g.key] = { kind: 'create', name: g.project.trim() };
    else projects[g.key] = null;
  }

  const clients: Decisions['clients'] = {};
  for (const c of groups.clients) {
    if (c.reason === 'exact') clients[c.key] = { kind: 'existing', clientId: c.exact[0].item.id };
    else if (c.reason === 'new') clients[c.key] = { kind: 'create', name: c.name.trim() };
    else clients[c.key] = null;
  }

  const people: Decisions['people'] = {};
  for (const p of groups.people) {
    people[p.key] = p.match ? { kind: 'existing', userId: p.match.userId } : null;
  }

  return { projects, taskMode, clients, people, rowInclude: {}, addMembers: true };
}

// ---- Plan --------------------------------------------------------------------------

export type RowStatus =
  | 'ready'
  | 'already' // key already imported
  | 'blocked' // unreadable or zero-length
  | 'undecided' // waiting on a project/person/client decision
  | 'skipped' // project or person set to skip
  | 'possible_duplicate' // same person, start and end as an existing entry
  | 'not_member' // person is not on the project and cannot be added
  | 'excluded'; // unticked by the user

export type ProjectRef = { kind: 'existing'; id: string } | { kind: 'create'; key: string };
export type WorkItemRef = { kind: 'existing'; id: string } | { kind: 'create'; name: string };

export interface PlannedRow {
  row: ImportRow;
  status: RowStatus;
  warnings: RowProblem[];
  /** Included in the import (status 'ready'). */
  include: boolean;
  /** Matches an existing entry's person, start and end — shown for review even once included. */
  duplicate?: boolean;
  project?: ProjectRef;
  userId?: string;
  workItem?: WorkItemRef | null;
  customText?: string | null;
  willAddMember?: boolean;
}

export interface NewProject {
  key: string;
  name: string;
  client: { kind: 'existing'; id: string } | { kind: 'create'; key: string } | null;
}

export interface NewClient {
  key: string;
  name: string;
}

export interface Plan {
  rows: PlannedRow[];
  counts: Record<RowStatus, number>;
  readyMinutes: number;
  /** Groups still waiting on a decision; the import is blocked while > 0. */
  undecided: { projects: string[]; people: string[]; clients: string[] };
  newProjects: NewProject[];
  newClients: NewClient[];
  /** projectRef key → work item names to create. */
  newWorkItems: Map<string, string[]>;
  membersToAdd: number;
  /** Client keys that matter, i.e. used by a project being created. */
  clientsInUse: Set<string>;
}

export const refKey = (p: ProjectRef) => (p.kind === 'existing' ? `id:${p.id}` : `new:${p.key}`);

const DUP_TOLERANCE_MS = 60_000;

export function computePlan(
  file: ParsedFile,
  dir: Directory,
  groups: Groups,
  d: Decisions,
  existing: ExistingState | null,
): Plan {
  const projectById = new Map(dir.projects.map((p) => [p.id, p]));
  const projectGroupByKey = new Map(groups.projects.map((g) => [g.key, g]));

  // Work items by project and normalised name.
  const itemsByProject = new Map<string, Map<string, string>>();
  for (const w of dir.workItems) {
    let m = itemsByProject.get(w.projectId);
    if (!m) itemsByProject.set(w.projectId, (m = new Map()));
    const k = normName(w.name);
    if (!m.has(k)) m.set(k, w.id);
  }

  // Existing entries per person, for the duplicate check.
  const entriesByUser = new Map<string, ExistingEntry[]>();
  for (const e of existing?.entries ?? []) {
    const arr = entriesByUser.get(e.userId);
    if (arr) arr.push(e);
    else entriesByUser.set(e.userId, [e]);
  }

  const newProjects = new Map<string, NewProject>();
  const newClients = new Map<string, NewClient>();
  const clientsInUse = new Set<string>();
  const undecidedClients = new Set<string>();

  // Resolve each project group once.
  const groupRef = new Map<string, ProjectRef | 'skip' | null>();
  for (const g of groups.projects) {
    const dec = d.projects[g.key];
    if (!dec) {
      groupRef.set(g.key, null);
      continue;
    }
    if (dec.kind === 'skip') {
      groupRef.set(g.key, 'skip');
      continue;
    }
    if (dec.kind === 'existing') {
      // A project I cannot edit cannot take imported time — still undecided.
      const p = projectById.get(dec.projectId);
      groupRef.set(g.key, p && canEdit(p) ? { kind: 'existing', id: dec.projectId } : null);
      continue;
    }
    const name = dec.name.trim();
    if (!name) {
      groupRef.set(g.key, null);
      continue;
    }
    // Two file projects given the same new name become one project.
    const key = normName(name);
    groupRef.set(g.key, { kind: 'create', key });
    if (newProjects.has(key)) continue;

    let client: NewProject['client'] = null;
    if (g.client.trim()) {
      const ck = clientGroupKey(g.client);
      clientsInUse.add(ck);
      const cd = d.clients[ck];
      if (!cd) undecidedClients.add(ck);
      else if (cd.kind === 'existing') client = { kind: 'existing', id: cd.clientId };
      else if (cd.kind === 'create' && cd.name.trim()) {
        const nk = normName(cd.name);
        client = { kind: 'create', key: nk };
        if (!newClients.has(nk)) newClients.set(nk, { key: nk, name: cd.name.trim() });
      } else if (cd.kind === 'create') undecidedClients.add(ck);
    }
    newProjects.set(key, { key, name, client });
  }

  const newWorkItems = new Map<string, string[]>();
  const newWorkItemSeen = new Set<string>();
  const membersAdded = new Set<string>();

  const rows: PlannedRow[] = file.rows.map((row) => {
    const warnings = row.problems.filter((p) => !BLOCKING_PROBLEMS.has(p));
    const base = { row, warnings, include: false };

    if (existing?.keys.has(row.key)) return { ...base, status: 'already' };
    if (row.problems.some((p) => BLOCKING_PROBLEMS.has(p))) return { ...base, status: 'blocked' };

    const g = projectGroupByKey.get(projectGroupKey(row))!;
    const ref = groupRef.get(g.key);
    const pd = d.people[personGroupKey(row)];
    if (ref === 'skip' || pd?.kind === 'skip') return { ...base, status: 'skipped' };
    if (!ref || !pd) return { ...base, status: 'undecided' };
    const userId = pd.userId;

    if (ref.kind === 'create' && g.client.trim() && undecidedClients.has(clientGroupKey(g.client))) {
      return { ...base, status: 'undecided' };
    }

    // Membership: the person must be on the project, or be addable by me.
    let willAddMember = false;
    if (ref.kind === 'existing') {
      const p = projectById.get(ref.id)!;
      if (!p.memberIds.has(userId)) {
        if (d.addMembers && p.myRole === 'owner' && dir.orgPeopleIds.has(userId)) willAddMember = true;
        else return { ...base, status: 'not_member', project: ref, userId };
      }
    } else if (userId !== dir.me && !dir.orgMemberIds.has(userId)) {
      // A new project: org members see it anyway; a guest needs adding.
      if (d.addMembers && dir.orgPeopleIds.has(userId)) willAddMember = true;
      else return { ...base, status: 'not_member', project: ref, userId };
    }

    // Task → work item.
    let workItem: WorkItemRef | null = null;
    let customText: string | null = null;
    if (row.task) {
      const matchId =
        ref.kind === 'existing' ? itemsByProject.get(ref.id)?.get(normName(row.task)) : undefined;
      if (matchId) workItem = { kind: 'existing', id: matchId };
      else if ((d.taskMode[g.key] ?? 'workItem') === 'workItem') {
        workItem = { kind: 'create', name: row.task.trim() };
      } else customText = row.task.trim();
    }

    // Same person, same start and end as something already logged.
    const dup = (entriesByUser.get(userId) ?? []).some(
      (e) =>
        e.endAt &&
        Math.abs(Date.parse(e.startAt) - Date.parse(row.startAt!)) < DUP_TOLERANCE_MS &&
        Math.abs(Date.parse(e.endAt) - Date.parse(row.endAt!)) < DUP_TOLERANCE_MS,
    );
    const override = d.rowInclude[row.index];
    const planned = { ...base, project: ref, userId, workItem, customText, willAddMember, duplicate: dup };
    if (dup && override !== true) return { ...planned, status: 'possible_duplicate' };
    if (override === false) return { ...planned, status: 'excluded' };

    if (workItem?.kind === 'create') {
      const rk = refKey(ref);
      const seenKey = `${rk}\u0000${normName(workItem.name)}`;
      if (!newWorkItemSeen.has(seenKey)) {
        newWorkItemSeen.add(seenKey);
        const arr = newWorkItems.get(rk);
        if (arr) arr.push(workItem.name);
        else newWorkItems.set(rk, [workItem.name]);
      }
    }
    if (willAddMember) membersAdded.add(`${refKey(ref)}\u0000${userId}`);
    return { ...planned, status: 'ready', include: true };
  });

  const counts = {
    ready: 0,
    already: 0,
    blocked: 0,
    undecided: 0,
    skipped: 0,
    possible_duplicate: 0,
    not_member: 0,
    excluded: 0,
  } as Record<RowStatus, number>;
  let readyMinutes = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.status === 'ready') readyMinutes += r.row.minutes ?? 0;
  }

  // Only projects/clients that would actually receive rows are created.
  const usedProjects = new Set(
    rows.filter((r) => r.include && r.project?.kind === 'create').map((r) => (r.project as { key: string }).key),
  );
  const finalProjects = [...newProjects.values()].filter((p) => usedProjects.has(p.key));
  const usedClients = new Set(
    finalProjects.flatMap((p) => (p.client?.kind === 'create' ? [p.client.key] : [])),
  );

  return {
    rows,
    counts,
    readyMinutes,
    undecided: {
      projects: groups.projects.filter((g) => groupRef.get(g.key) === null).map((g) => g.key),
      people: groups.people.filter((p) => !d.people[p.key]).map((p) => p.key),
      clients: [...undecidedClients],
    },
    newProjects: finalProjects,
    newClients: [...newClients.values()].filter((c) => usedClients.has(c.key)),
    newWorkItems,
    membersToAdd: membersAdded.size,
    clientsInUse,
  };
}

/** Similar names for a free-text value — used to warn when "create" would make a near-duplicate. */
export function nearNames<T>(name: string, items: T[], nameOf: (t: T) => string): T[] {
  return items.filter((i) => {
    const s = similarity(name, nameOf(i));
    return s >= SUGGEST_THRESHOLD;
  });
}
