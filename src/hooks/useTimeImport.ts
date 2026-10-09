import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { displayName } from '@/lib/userDisplay';
import { newId } from '@/lib/id';
import type { ImportRow } from '@/lib/import/clockify';
import { normName } from '@/lib/import/match';
import {
  IMPORT_SOURCE,
  type Decisions,
  type DirClient,
  type DirPerson,
  type DirProject,
  type Directory,
  type ExistingEntry,
  type ExistingState,
  type Plan,
  type ProjectRef,
} from '@/lib/import/plan';
import type { ProjectRole, VisibleClient } from '@/types/db';
import { timeEntriesKey } from './useTimeEntries';
import { trackerCatalogKey } from './useTrackerCatalog';
import { trackerPeopleKey } from './useTrackerPeople';
import { projectsKey } from './useProjects';
import { clientsKey, visibleClientsKey } from './useClients';
import { tasksDataKey } from './useTasksData';

/** The import columns / RPC from sql/time_entry_import.sql are not on the database yet. */
export class ImportSetupMissingError extends Error {}

const directoryKey = ['tracker', 'import', 'directory'] as const;

interface MemberRow {
  user_id: string;
  role?: ProjectRole;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
}

// Everything the mapping step needs to know about the workspace: projects
// with my role and their members, people I can see (project members and
// teammates), clients, work items, and my teams.
export function useImportDirectory(enabled: boolean) {
  return useQuery({
    queryKey: directoryKey,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Directory> => {
      const { data: u } = await supabase.auth.getUser();
      const me = u.user?.id;
      if (!me) throw new Error('Not authenticated');

      const [pRes, cRes, vcRes, wRes, tRes] = await Promise.all([
        supabase.from('projects').select('id,name,client_id').is('deleted_at', null).order('name'),
        supabase.from('clients').select('id,name,team_id').is('deleted_at', null).order('name'),
        supabase.rpc('my_visible_clients'),
        supabase.from('work_items').select('id,project_id,parent_id,name,position').is('deleted_at', null),
        supabase.rpc('my_teams_list'),
      ]);
      for (const r of [pRes, cRes, vcRes, wRes, tRes]) if (r.error) throw r.error;

      const projectsRaw = (pRes.data ?? []) as { id: string; name: string; client_id: string | null }[];
      const clientsRaw = (cRes.data ?? []) as { id: string; name: string; team_id: string | null }[];
      const visible = new Map(((vcRes.data ?? []) as VisibleClient[]).map((c) => [c.id, c]));
      const teams = ((tRes.data ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }));

      const [memberLists, teamLists] = await Promise.all([
        Promise.all(
          projectsRaw.map((p) =>
            supabase.rpc('project_members_list', { p_project: p.id }).then((r) => (r.data ?? []) as MemberRow[]),
          ),
        ),
        Promise.all(
          teams.map((t) =>
            supabase.rpc('team_members_list', { p_team: t.id }).then((r) => (r.data ?? []) as MemberRow[]),
          ),
        ),
      ]);

      const people = new Map<string, DirPerson>();
      const addPerson = (m: MemberRow) => {
        if (people.has(m.user_id)) return;
        people.set(m.user_id, {
          userId: m.user_id,
          name: displayName(m),
          email: m.email?.toLowerCase() ?? null,
        });
      };
      const teammateIds = new Set<string>();
      for (const list of teamLists) for (const m of list) {
        teammateIds.add(m.user_id);
        addPerson(m);
      }

      const clientName = new Map(clientsRaw.map((c) => [c.id, c.name]));
      const projects: DirProject[] = projectsRaw.map((p, i) => {
        const members = memberLists[i];
        for (const m of members) addPerson(m);
        return {
          id: p.id,
          name: p.name,
          clientId: p.client_id,
          clientName: p.client_id ? (clientName.get(p.client_id) ?? null) : null,
          myRole: members.find((m) => m.user_id === me)?.role ?? null,
          memberIds: new Set(members.map((m) => m.user_id)),
        };
      });

      const clients: DirClient[] = clientsRaw.map((c) => {
        const v = visible.get(c.id);
        return {
          id: c.id,
          name: c.name,
          scope: v?.scope ?? (c.team_id ? 'team' : 'private'),
          teamName: v?.team_name ?? null,
        };
      });

      return {
        me,
        projects,
        people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
        clients,
        workItems: ((wRes.data ?? []) as {
          id: string;
          project_id: string;
          parent_id: string | null;
          name: string;
          position: number;
        }[]).map((w) => ({
          id: w.id,
          projectId: w.project_id,
          parentId: w.parent_id,
          name: w.name,
          position: w.position,
        })),
        teammateIds,
        teams,
      };
    },
  });
}

const UNDEFINED_COLUMN = '42703';
const UNDEFINED_FUNCTION = 'PGRST202';

// Which rows of this file are already in, and what is already logged in the
// file's date window (to spot the same session entered twice by hand).
export function useImportExistingState(rows: ImportRow[] | null, signature: string | null) {
  return useQuery({
    queryKey: ['tracker', 'import', 'existing', signature],
    enabled: !!rows && !!signature,
    retry: false,
    queryFn: async (): Promise<ExistingState> => {
      const list = rows ?? [];
      const keys = new Set<string>();
      const all = list.map((r) => r.key);
      for (let i = 0; i < all.length; i += 200) {
        const { data, error } = await supabase
          .from('time_entries')
          .select('import_key')
          .eq('import_source', IMPORT_SOURCE)
          .in('import_key', all.slice(i, i + 200));
        if (error) {
          if (error.code === UNDEFINED_COLUMN) throw new ImportSetupMissingError(error.message);
          throw error;
        }
        for (const r of data ?? []) keys.add((r as { import_key: string }).import_key);
      }

      const starts = list.map((r) => r.startAt).filter((s): s is string => !!s).sort();
      const entries: ExistingEntry[] = [];
      if (starts.length > 0) {
        const from = new Date(Date.parse(starts[0]) - 86_400_000).toISOString();
        const to = new Date(Date.parse(starts[starts.length - 1]) + 86_400_000).toISOString();
        for (let off = 0; ; off += 1000) {
          const { data, error } = await supabase
            .from('time_entries')
            .select('user_id,start_at,end_at')
            .gte('start_at', from)
            .lte('start_at', to)
            .order('start_at')
            .range(off, off + 999);
          if (error) throw error;
          for (const e of (data ?? []) as { user_id: string; start_at: string; end_at: string | null }[]) {
            entries.push({ userId: e.user_id, startAt: e.start_at, endAt: e.end_at });
          }
          if (!data || data.length < 1000) break;
        }
      }
      return { keys, entries };
    },
  });
}

export interface ImportProgress {
  step: 'clients' | 'projects' | 'workItems' | 'entries' | 'done';
  done: number;
  total: number;
}

export interface ImportResult {
  batchId: string;
  inserted: number;
  duplicates: number;
  membersAdded: number;
  createdClients: number;
  createdProjects: number;
  createdWorkItems: number;
  errors: { line: number | null; reason: string; detail?: string }[];
}

const RPC_CHUNK = 500;

// Runs a plan. Not transactional across steps: clients, projects and work
// items are created first and stay if a later step fails. That is safe to
// retry — a second run matches them by name, and the entry keys stop any
// row being inserted twice.
export function useRunTimeImport() {
  const qc = useQueryClient();

  async function run(
    plan: Plan,
    decisions: Decisions,
    dir: Directory,
    onProgress: (p: ImportProgress) => void,
  ): Promise<ImportResult> {
    const batchId = newId();
    const result: ImportResult = {
      batchId,
      inserted: 0,
      duplicates: 0,
      membersAdded: 0,
      createdClients: 0,
      createdProjects: 0,
      createdWorkItems: 0,
      errors: [],
    };

    try {
      // 1. Clients.
      const clientIds = new Map<string, string>();
      onProgress({ step: 'clients', done: 0, total: plan.newClients.length });
      for (const [i, c] of plan.newClients.entries()) {
        const { data, error } = await supabase.rpc('create_client', { p_name: c.name, p_team_id: c.teamId });
        if (error) throw new Error(`Client "${c.name}": ${error.message}`);
        clientIds.set(c.key, (data as { id: string }).id);
        result.createdClients++;
        onProgress({ step: 'clients', done: i + 1, total: plan.newClients.length });
      }

      // 2. Projects (+ their client).
      const projectIds = new Map<string, string>();
      onProgress({ step: 'projects', done: 0, total: plan.newProjects.length });
      for (const [i, p] of plan.newProjects.entries()) {
        const { data, error } = await supabase.rpc('create_project', {
          p_name: p.name,
          p_description: 'Imported from Clockify',
        });
        if (error) throw new Error(`Project "${p.name}": ${error.message}`);
        const id = (data as { id: string }).id;
        projectIds.set(p.key, id);
        result.createdProjects++;
        const clientId =
          p.client?.kind === 'existing' ? p.client.id : p.client ? clientIds.get(p.client.key) : null;
        if (clientId) {
          const { error: ce } = await supabase.rpc('set_project_client', {
            p_project_id: id,
            p_client_id: clientId,
          });
          if (ce) throw new Error(`Project "${p.name}" client: ${ce.message}`);
        }
        onProgress({ step: 'projects', done: i + 1, total: plan.newProjects.length });
      }

      const resolve = (ref: ProjectRef): string =>
        ref.kind === 'existing' ? ref.id : projectIds.get(ref.key)!;

      // 3. Work items for task names with no match, appended at root level.
      const workItemIds = new Map<string, string>();
      const wiKey = (projectId: string, name: string) => `${projectId}\u0000${normName(name)}`;
      const wiTotal = [...plan.newWorkItems.values()].reduce((n, a) => n + a.length, 0);
      let wiDone = 0;
      onProgress({ step: 'workItems', done: 0, total: wiTotal });
      for (const [rk, names] of plan.newWorkItems) {
        const ref: ProjectRef = rk.startsWith('id:')
          ? { kind: 'existing', id: rk.slice(3) }
          : { kind: 'create', key: rk.slice(4) };
        const projectId = resolve(ref);
        const rootMax = dir.workItems
          .filter((w) => w.projectId === projectId && !w.parentId)
          .reduce((m, w) => Math.max(m, w.position), 0);
        const { data, error } = await supabase
          .from('work_items')
          .insert(
            names.map((name, i) => ({
              project_id: projectId,
              parent_id: null,
              name,
              position: rootMax + (i + 1) * 1000,
              progress: 0,
              created_by: dir.me,
            })),
          )
          .select('id,name');
        if (error) throw new Error(`Tasks: ${error.message}`);
        for (const w of (data ?? []) as { id: string; name: string }[]) {
          workItemIds.set(wiKey(projectId, w.name), w.id);
        }
        result.createdWorkItems += names.length;
        wiDone += names.length;
        onProgress({ step: 'workItems', done: wiDone, total: wiTotal });
      }

      // 4. Entries.
      const rows = plan.rows.filter((r) => r.include);
      const lineByKey = new Map(rows.map((r) => [r.row.key, r.row.line]));
      const payload = rows.map((r) => {
        const projectId = resolve(r.project!);
        const wi = r.workItem;
        return {
          key: r.row.key,
          user_id: r.userId,
          project_id: projectId,
          work_item_id:
            wi?.kind === 'existing' ? wi.id : wi ? (workItemIds.get(wiKey(projectId, wi.name)) ?? null) : null,
          custom_task_text: r.customText ?? null,
          notes: r.row.description || null,
          start_at: r.row.startAt,
          end_at: r.row.endAt,
        };
      });
      onProgress({ step: 'entries', done: 0, total: payload.length });
      for (let i = 0; i < payload.length; i += RPC_CHUNK) {
        const chunk = payload.slice(i, i + RPC_CHUNK);
        const { data, error } = await supabase.rpc('import_time_entries', {
          p_source: IMPORT_SOURCE,
          p_batch: batchId,
          p_rows: chunk,
          p_add_members: decisions.addMembers,
        });
        if (error) {
          if (error.code === UNDEFINED_FUNCTION) throw new ImportSetupMissingError(error.message);
          throw error;
        }
        const res = data as {
          inserted: number;
          duplicates: number;
          members_added: number;
          errors: { key: string | null; reason: string; detail?: string }[];
        };
        result.inserted += res.inserted;
        result.duplicates += res.duplicates;
        result.membersAdded += res.members_added;
        for (const e of res.errors) {
          result.errors.push({
            line: e.key ? (lineByKey.get(e.key) ?? null) : null,
            reason: e.reason,
            detail: e.detail,
          });
        }
        onProgress({ step: 'entries', done: Math.min(i + RPC_CHUNK, payload.length), total: payload.length });
      }
      onProgress({ step: 'done', done: 1, total: 1 });
      return result;
    } finally {
      invalidate();
    }
  }

  async function undo(batchId: string): Promise<number> {
    const { data, error } = await supabase.rpc('undo_time_entry_import', { p_batch: batchId });
    invalidate();
    if (error) throw error;
    return (data as number) ?? 0;
  }

  function invalidate() {
    for (const key of [
      timeEntriesKey,
      trackerCatalogKey,
      trackerPeopleKey,
      projectsKey,
      clientsKey,
      visibleClientsKey,
      tasksDataKey,
      ['work_items'],
      ['tracker', 'import'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  }

  return { run, undo };
}

