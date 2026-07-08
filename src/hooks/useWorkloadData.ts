import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildCalendar, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { displayName } from '@/lib/userDisplay';
import { leafItemIds } from '@/lib/workload';
import { useMyTeams } from './useTeams';
import type { TeamMember, WorkItem } from '@/types/db';

export interface WorkloadPerson {
  user_id: string;
  display_name: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface WorkloadProjectInfo {
  id: string;
  name: string;
}

export interface WorkloadTeamInfo {
  id: string;
  name: string;
}

export interface WorkloadData {
  /** People in one of my teams (Rule A). */
  people: WorkloadPerson[];
  /** Leaf, dated tasks assigned to a visible person, in projects I belong to (Rule B). */
  tasks: WorkItem[];
  /** Projects I can see — for the project filter. */
  projects: WorkloadProjectInfo[];
  /** My teams — for the team filter. */
  teams: WorkloadTeamInfo[];
  /** team_id -> member user_ids, for the team filter. */
  teamMembership: Record<string, string[]>;
  /** Shared working calendar (union of project calendars) for axis + load math. */
  calendar: WorkCalendar;
}

export const workloadDataKey = (teamIds: string[]) => ['workload', 'data', teamIds] as const;

// Assembles the workload dataset. Mirrors useTrackerCatalog: a handful of RLS-gated
// reads run in parallel. RLS on work_items/projects already limits rows to projects
// the current user belongs to, so Rule B ("only tasks in my projects") is enforced
// server-side; the people axis is built strictly from my team members (Rule A).
export function useWorkloadData() {
  const { data: myTeams } = useMyTeams();
  const teamIds = (myTeams ?? []).map((t) => t.id).sort();

  return useQuery({
    queryKey: workloadDataKey(teamIds),
    enabled: !!myTeams,
    queryFn: async (): Promise<WorkloadData> => {
      const teamList = myTeams ?? [];

      // People axis (Rule A): union of members across my teams.
      const memberLists = await Promise.all(
        teamList.map((tm) =>
          supabase
            .rpc('team_members_list', { p_team: tm.id })
            .then((r) => ({ teamId: tm.id, rows: (r.data ?? []) as TeamMember[] })),
        ),
      );
      const peopleById = new Map<string, WorkloadPerson>();
      const teamMembership: Record<string, string[]> = {};
      for (const { teamId, rows } of memberLists) {
        teamMembership[teamId] = rows.map((m) => m.user_id);
        for (const m of rows) {
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
      const peopleSet = new Set(peopleById.keys());

      // Projects, work items, non-working days — all RLS-gated to projects I belong to.
      const [pRes, wRes, nRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id,name,working_days')
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('work_items')
          .select(
            'id,project_id,parent_id,level,name,start_date,end_date,assignee_id,progress,created_by',
          )
          .is('deleted_at', null),
        supabase.from('non_working_days').select('start_date,end_date'),
      ]);
      if (pRes.error) throw pRes.error;
      if (wRes.error) throw wRes.error;
      if (nRes.error) throw nRes.error;

      const projects = (pRes.data ?? []) as { id: string; name: string; working_days: number[] }[];
      const allItems = (wRes.data ?? []) as WorkItem[];
      const nonWorking = (nRes.data ?? []) as { start_date: string; end_date: string }[];

      const leaves = leafItemIds(allItems);
      const tasks = allItems.filter(
        (it) =>
          leaves.has(it.id) &&
          !!it.start_date &&
          !!it.end_date &&
          !!it.assignee_id &&
          peopleSet.has(it.assignee_id),
      );

      // Shared calendar: union of working days across visible projects (default Mon–Fri).
      const weekly = new Set<number>();
      for (const p of projects) for (const d of p.working_days ?? []) weekly.add(d);
      const workingDays = weekly.size > 0 ? Array.from(weekly) : [1, 2, 3, 4, 5];
      const calendar = buildCalendar(workingDays, nonWorking);

      return {
        people: Array.from(peopleById.values()).sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        ),
        tasks,
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        teams: teamList.map((t) => ({ id: t.id, name: t.name })),
        teamMembership,
        calendar,
      };
    },
  });
}
