import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildCalendar, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { displayName } from '@/lib/userDisplay';
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
  /** Every work item in every project I belong to. */
  items: WorkItem[];
  /** Dependency edges across those projects — needed for a round-trippable export. */
  dependencies: Dependency[];
  /** Projects I can see, name-ascending. */
  projects: TasksProjectInfo[];
  /** Everyone who is a member of at least one of those projects. */
  people: TasksPerson[];
  /** project_id -> member user_ids, so the assignee filter can narrow by project. */
  membership: Record<string, string[]>;
  /** Projects where I'm owner or editor — everywhere else the UI is read-only. */
  editableProjectIds: Set<string>;
  /** My user id, for "assigned to me" ordering and quick-add. */
  currentUserId: string | null;
  /** Per-project working calendar, for date snapping on create. */
  calendarByProject: Map<string, WorkCalendar>;
}

export const tasksDataKey = ['tasks', 'global'] as const;

const EDITOR_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(['owner', 'editor']);

interface MemberRow {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
}

// Assembles the global task dataset. Mirrors useWorkloadData: a handful of
// RLS-gated reads run in parallel with NO project_id filter — the `wi_select`
// policy (`is_member(project_id) and deleted_at is null`) already restricts rows
// to projects the current user belongs to, so scoping is enforced server-side.
//
// The people axis is built from project members rather than team membership
// (which is what useWorkloadData uses): a task can be assigned to any member of
// its project, and the enforce_assignee_membership trigger guarantees exactly
// that, so project membership is the correct superset. Going via teams would
// silently drop assignees who don't share a team with you.
export function useTasksData() {
  return useQuery({
    queryKey: tasksDataKey,
    queryFn: async (): Promise<TasksData> => {
      const { data: userRes } = await supabase.auth.getUser();
      const currentUserId = userRes.user?.id ?? null;

      const pRes = await supabase
        .from('projects')
        .select('id,name,working_days')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (pRes.error) throw pRes.error;
      const projects = (pRes.data ?? []) as TasksProjectInfo[];

      const [wRes, dRes, nRes, memberLists] = await Promise.all([
        supabase.from('work_items').select('*').is('deleted_at', null),
        supabase.from('dependencies').select('*'),
        supabase.from('non_working_days').select('project_id,start_date,end_date'),
        // project_members_list is SECURITY DEFINER and joins auth.users, so it is
        // the only way to get real names and emails: the client cannot read
        // auth.users, and user_settings only covers people who have set a name
        // (8 of 14 members today — the rest would render as truncated uuids).
        Promise.all(
          projects.map((p) =>
            supabase
              .rpc('project_members_list', { p_project: p.id })
              .then((r) => ({ projectId: p.id, rows: (r.data ?? []) as MemberRow[] })),
          ),
        ),
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
      const editableProjectIds = new Set<string>();
      const peopleById = new Map<string, TasksPerson>();

      for (const { projectId, rows } of memberLists) {
        membership[projectId] = rows.map((m) => m.user_id);
        for (const m of rows) {
          if (m.user_id === currentUserId && EDITOR_ROLES.has(m.role)) {
            editableProjectIds.add(projectId);
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
      }

      // Fallback for any project whose RPC came back empty (it is gated by
      // is_member, so an empty list is possible). Names degrade to a short id,
      // which is still better than dropping the person from the filter.
      const missing = projects.filter((p) => (membership[p.id] ?? []).length === 0);
      if (missing.length > 0) {
        const raw = await supabase
          .from('project_members')
          .select('project_id,user_id,role')
          .in(
            'project_id',
            missing.map((p) => p.id),
          );
        for (const m of (raw.data ?? []) as MemberRow[]) {
          (membership[m.project_id] ??= []).push(m.user_id);
          if (m.user_id === currentUserId && EDITOR_ROLES.has(m.role)) {
            editableProjectIds.add(m.project_id);
          }
          if (peopleById.has(m.user_id)) continue;
          peopleById.set(m.user_id, {
            user_id: m.user_id,
            display_name: displayName({ user_id: m.user_id }),
            email: null,
            first_name: null,
            last_name: null,
          });
        }
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
        editableProjectIds,
        currentUserId,
        calendarByProject,
      };
    },
  });
}
