import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildCalendar, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { displayName } from '@/lib/userDisplay';
import { useCurrentOrg } from '@/lib/currentOrg';
import { fetchOrgProjectMembers } from './useOrgs';
import type { Dependency, ProjectRole, WorkItem } from '@/types/db';

export interface TasksPerson {
  user_id: string;
  display_name: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface TasksProjectInfo {
  id: string;
  name: string;
  working_days: number[];
}

export interface TasksData {
  /** Every work item in the current organization's projects I can see. */
  items: WorkItem[];
  /** Dependency edges across those projects — needed for a round-trippable export. */
  dependencies: Dependency[];
  /** Projects I can see in the current organization, name-ascending. */
  projects: TasksProjectInfo[];
  /** Everyone with access to at least one of those projects — for names. */
  people: TasksPerson[];
  /** project_id -> people who can work on it (editors and owners): the assignee choices. */
  membership: Record<string, string[]>;
  /**
   * project_id -> people with an own role on it: the ones added to it, whom the
   * Projects list shows. Every org member can edit every project, so the
   * editors alone would list the whole organization on each row.
   */
  projectTeam: Record<string, string[]>;
  /** Projects where I'm owner or editor — everywhere else the UI is read-only. */
  editableProjectIds: Set<string>;
  /** My user id, for "assigned to me" ordering and quick-add. */
  currentUserId: string | null;
  /** Per-project working calendar, for date snapping on create. */
  calendarByProject: Map<string, WorkCalendar>;
}

// Prefix for invalidation; the data itself is per organization (tasksDataOrgKey).
export const tasksDataKey = ['tasks', 'global'] as const;
export const tasksDataOrgKey = (orgId: string) => ['tasks', 'global', orgId] as const;

const EDITOR_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(['owner', 'editor']);

// The cached dataset that holds this project, whichever organization's it is.
export function findTasksData(qc: QueryClient, projectId: string): TasksData | undefined {
  for (const [, data] of qc.getQueriesData<TasksData>({ queryKey: tasksDataKey })) {
    if (data?.projects.some((p) => p.id === projectId)) return data;
  }
  return undefined;
}

// Assembles the task dataset of the current organization: its projects, then
// their items, edges and non-working days, all RLS-gated. People come from
// org_project_members — SECURITY DEFINER and joined to auth.users, so it is the
// only way to get real names and emails (user_settings only covers people who
// have set a name; the rest would render as truncated uuids).
//
// The people axis is project access, not org membership: a task can be
// assigned to anyone on its project, guests included.
export function useTasksData() {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: tasksDataOrgKey(org.id),
    queryFn: async (): Promise<TasksData> => {
      const { data: userRes } = await supabase.auth.getUser();
      const currentUserId = userRes.user?.id ?? null;

      const pRes = await supabase
        .from('projects')
        .select('id,name,working_days')
        .eq('org_id', org.id)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (pRes.error) throw pRes.error;
      const projects = (pRes.data ?? []) as TasksProjectInfo[];
      const projectIds = projects.map((p) => p.id);

      const empty = { data: [], error: null };
      const [wRes, dRes, nRes, access] = await Promise.all([
        projectIds.length
          ? supabase.from('work_items').select('*').in('project_id', projectIds).is('deleted_at', null)
          : empty,
        projectIds.length ? supabase.from('dependencies').select('*').in('project_id', projectIds) : empty,
        projectIds.length
          ? supabase.from('non_working_days').select('project_id,start_date,end_date').in('project_id', projectIds)
          : empty,
        fetchOrgProjectMembers(org.id),
      ]);
      if (wRes.error) throw wRes.error;
      if (dRes.error) throw dRes.error;
      if (nRes.error) throw nRes.error;

      const items = (wRes.data ?? []) as WorkItem[];
      const dependencies = (dRes.data ?? []) as Dependency[];
      const nonWorking = (nRes.data ?? []) as {
        project_id: string;
        start_date: string;
        end_date: string;
      }[];

      const membership: Record<string, string[]> = {};
      const projectTeam: Record<string, string[]> = {};
      const editableProjectIds = new Set<string>();
      const peopleById = new Map<string, TasksPerson>();

      for (const m of access) {
        if (m.direct_role) (projectTeam[m.project_id] ??= []).push(m.user_id);
        if (EDITOR_ROLES.has(m.role)) {
          (membership[m.project_id] ??= []).push(m.user_id);
          if (m.user_id === currentUserId) editableProjectIds.add(m.project_id);
        }
        if (peopleById.has(m.user_id)) continue;
        peopleById.set(m.user_id, {
          user_id: m.user_id,
          display_name: displayName(m),
          email: m.email ?? null,
          first_name: m.first_name ?? null,
          last_name: m.last_name ?? null,
        });
      }

      const nonWorkingByProject = new Map<string, { start_date: string; end_date: string }[]>();
      for (const n of nonWorking) {
        const arr = nonWorkingByProject.get(n.project_id);
        if (arr) arr.push(n);
        else nonWorkingByProject.set(n.project_id, [n]);
      }
      const calendarByProject = new Map<string, WorkCalendar>();
      for (const p of projects) {
        const weekly = p.working_days?.length ? p.working_days : [1, 2, 3, 4, 5];
        calendarByProject.set(p.id, buildCalendar(weekly, nonWorkingByProject.get(p.id) ?? []));
      }

      return {
        items,
        dependencies,
        projects,
        people: Array.from(peopleById.values()).sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        ),
        membership,
        projectTeam,
        editableProjectIds,
        currentUserId,
        calendarByProject,
      };
    },
  });
}
