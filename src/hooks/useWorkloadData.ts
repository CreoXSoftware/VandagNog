import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildCalendar, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { displayName } from '@/lib/userDisplay';
import { useCurrentOrg } from '@/lib/currentOrg';
import { leafItemIds } from '@/lib/workload';
import { fetchOrgProjectMembers } from './useOrgs';
import type { WorkItem } from '@/types/db';

export interface WorkloadPerson {
  user_id: string;
  display_name: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  /** A guest of the organization (sees only projects shared with them). */
  is_guest: boolean;
}

export interface WorkloadProjectInfo {
  id: string;
  name: string;
}

export interface WorkloadData {
  /** Everyone with access to a project of the current organization that I can see. */
  people: WorkloadPerson[];
  /** Leaf, dated tasks assigned to one of those people, in those projects. */
  tasks: WorkItem[];
  /** Projects I can see in the current organization — for the project filter. */
  projects: WorkloadProjectInfo[];
  /** Shared working calendar (union of project calendars) for axis + load math. */
  calendar: WorkCalendar;
}

export const workloadDataKey = (orgId: string) => ['workload', 'data', orgId] as const;

// Assembles the workload dataset of the current organization. Mirrors
// useTasksData: RLS limits projects and items to what I can see, and the people
// axis is everyone with access to those projects (org members and the guests
// they were shared with), so a task's assignee always has a row.
export function useWorkloadData() {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: workloadDataKey(org.id),
    queryFn: async (): Promise<WorkloadData> => {
      const pRes = await supabase
        .from('projects')
        .select('id,name,working_days')
        .eq('org_id', org.id)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (pRes.error) throw pRes.error;
      const projects = (pRes.data ?? []) as { id: string; name: string; working_days: number[] }[];
      const projectIds = projects.map((p) => p.id);

      const empty = { data: [], error: null };
      const [wRes, nRes, access] = await Promise.all([
        projectIds.length
          ? supabase
              .from('work_items')
              .select('id,project_id,parent_id,level,name,start_date,end_date,assignee_id,progress,created_by')
              .in('project_id', projectIds)
              .is('deleted_at', null)
          : empty,
        projectIds.length
          ? supabase.from('non_working_days').select('start_date,end_date').in('project_id', projectIds)
          : empty,
        fetchOrgProjectMembers(org.id),
      ]);
      if (wRes.error) throw wRes.error;
      if (nRes.error) throw nRes.error;

      const peopleById = new Map<string, WorkloadPerson>();
      for (const m of access) {
        if (peopleById.has(m.user_id)) continue;
        peopleById.set(m.user_id, {
          user_id: m.user_id,
          display_name: displayName(m),
          email: m.email ?? null,
          first_name: m.first_name ?? null,
          last_name: m.last_name ?? null,
          is_guest: m.org_role === 'guest',
        });
      }

      const allItems = (wRes.data ?? []) as WorkItem[];
      const nonWorking = (nRes.data ?? []) as { start_date: string; end_date: string }[];

      const leaves = leafItemIds(allItems);
      const tasks = allItems.filter(
        (it) =>
          leaves.has(it.id) &&
          !!it.start_date &&
          !!it.end_date &&
          !!it.assignee_id &&
          peopleById.has(it.assignee_id),
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
        calendar,
      };
    },
  });
}
