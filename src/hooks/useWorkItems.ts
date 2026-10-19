import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Dependency, NonWorkingDay, Project, WorkItem } from '@/types/db';
import { computeCascade, rollupDates } from '@/lib/cascade';
import { buildCalendar } from '@/components/gantt/ganttUtils';
import { markLocalWorkItemMutation } from '@/lib/localMutationGuard';
import { dependenciesKey } from './useDependencies';
import { nonWorkingDaysKey } from './useNonWorkingDays';
import { projectKey } from './useProjects';
import { findTasksData, tasksDataKey, type TasksData } from './useTasksData';
import { collectSubtreeIds, type ReparentUpdate } from '@/lib/workItemTree';

export const workItemsKey = (projectId: string) => ['work_items', projectId] as const;

// The "Recently deleted" list on the Tasks page. Every mutation that moves an
// item into or out of the bin invalidates it.
export const deletedWorkItemsKey = ['work_items', 'deleted'] as const;

// The global Tasks page holds every work item of an organization in one cache
// entry (one per org visited), so a project-scoped mutation has to patch it too
// or the row won't move until the next refetch. These helpers keep those caches
// in step without making the mutations depend on the page being mounted (they
// no-op when it isn't).
type TasksSnapshot = [readonly unknown[], TasksData | undefined][];

function patchTasksCache(
  qc: ReturnType<typeof useQueryClient>,
  apply: (items: WorkItem[]) => WorkItem[],
): TasksSnapshot {
  const prev = qc.getQueriesData<TasksData>({ queryKey: tasksDataKey });
  for (const [key, data] of prev) {
    if (data) qc.setQueryData<TasksData>(key, { ...data, items: apply(data.items) });
  }
  return prev;
}

function restoreTasksCache(
  qc: ReturnType<typeof useQueryClient>,
  prev: TasksSnapshot | undefined,
): void {
  for (const [key, data] of prev ?? []) qc.setQueryData(key, data);
}

export function useWorkItems(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? workItemsKey(projectId) : ['work_items', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<WorkItem[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('work_items')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('position', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateWorkItemInput {
  // Optional client-generated uuid. Supplying it lets an optimistic row use the
  // same id the server will store, so the real row replaces it seamlessly and
  // the provisional row is clickable straight away.
  id?: string;
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
  // Must be a member of the project — the enforce_assignee_membership trigger
  // rejects anyone else. Left undefined, a sub-task takes its parent's assignee.
  assignee_id?: string | null;
}

// The parent's assignee from whichever cache holds the parent: null when it is
// unassigned, undefined when the parent isn't cached (e.g. created a moment
// ago by the same quick-add batch).
function cachedParentAssignee(
  qc: ReturnType<typeof useQueryClient>,
  input: CreateWorkItemInput,
): string | null | undefined {
  if (!input.parent_id) return null;
  const find = (items: WorkItem[] | undefined) => items?.find((w) => w.id === input.parent_id);
  const parent =
    find(qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id))) ??
    find(findTasksData(qc, input.project_id)?.items);
  return parent ? parent.assignee_id : undefined;
}

export function useCreateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkItemInput): Promise<WorkItem> => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('Not authenticated');

      // A sub-task starts on its parent's assignee unless the caller chose one.
      let assignee = input.assignee_id;
      const inherited = assignee === undefined && !!input.parent_id;
      if (inherited) {
        assignee = cachedParentAssignee(qc, input);
        if (assignee === undefined) {
          const { data: parent } = await supabase
            .from('work_items')
            .select('assignee_id')
            .eq('id', input.parent_id!)
            .maybeSingle();
          assignee = (parent?.assignee_id as string | null | undefined) ?? null;
        }
      }

      const insert = (assignee_id: string | null) =>
        supabase
          .from('work_items')
          .insert({
            ...(input.id ? { id: input.id } : {}),
            project_id: input.project_id,
            parent_id: input.parent_id,
            name: input.name,
            description: input.description ?? null,
            deliverable: input.deliverable ?? null,
            start_date: input.start_date ?? null,
            end_date: input.end_date ?? null,
            duration_days: input.duration_days ?? null,
            progress: input.progress ?? 0,
            position: input.position ?? 0,
            assignee_id,
            created_by: userId,
          })
          .select()
          .single();

      let { data, error } = await insert(assignee ?? null);
      // An inherited assignee may since have left the project, which
      // enforce_assignee_membership rejects; the sub-task is still wanted.
      if (error && inherited && assignee) ({ data, error } = await insert(null));
      if (error) throw error;
      return data as WorkItem;
    },
    // Only optimistic when the caller supplied an id: without one the server
    // picks the uuid, so a provisional row could not be reconciled and would
    // flicker as a duplicate when the refetch lands.
    onMutate: async (input) => {
      if (!input.id) return { prevTasks: undefined };
      markLocalWorkItemMutation();
      await qc.cancelQueries({ queryKey: tasksDataKey });
      const assignee =
        input.assignee_id !== undefined ? input.assignee_id : (cachedParentAssignee(qc, input) ?? null);
      const prevTasks = patchTasksCache(qc, (items) => {
        const parent = input.parent_id ? items.find((w) => w.id === input.parent_id) : undefined;
        return [
          ...items,
          provisionalWorkItem({ ...input, assignee_id: assignee }, input.id!, parent ? parent.level + 1 : 0),
        ];
      });
      return { prevTasks };
    },
    onError: (_e, _input, ctx) => restoreTasksCache(qc, ctx?.prevTasks),
    onSettled: (data, _e, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(data?.project_id ?? input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
    },
  });
}

// A stand-in row shaped like what the server will return. level is derived from
// the cached parent; the DB trigger owns the real value and the refetch corrects
// anything that differs.
function provisionalWorkItem(input: CreateWorkItemInput, id: string, level: number): WorkItem {
  const now = new Date().toISOString();
  return {
    id,
    project_id: input.project_id,
    parent_id: input.parent_id,
    level,
    name: input.name,
    description: input.description ?? null,
    deliverable: input.deliverable ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    duration_days: input.duration_days ?? null,
    planned_start: null,
    planned_end: null,
    progress: input.progress ?? 0,
    assignee_id: input.assignee_id ?? null,
    position: input.position ?? 0,
    created_by: '',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export function useUpdateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string; patch: Partial<WorkItem> }): Promise<WorkItem> => {
      const { data, error } = await supabase
        .from('work_items')
        .update(input.patch)
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data as WorkItem;
    },
    onMutate: async (input) => {
      markLocalWorkItemMutation();
      await Promise.all([
        qc.cancelQueries({ queryKey: workItemsKey(input.project_id) }),
        qc.cancelQueries({ queryKey: tasksDataKey }),
      ]);
      const apply = (wi: WorkItem) =>
        wi.id === input.id ? ({ ...wi, ...input.patch } as WorkItem) : wi;

      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (prev) qc.setQueryData<WorkItem[]>(workItemsKey(input.project_id), prev.map(apply));
      const prevTasks = patchTasksCache(qc, (items) => items.map(apply));

      return { prev, prevTasks };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
      restoreTasksCache(qc, ctx?.prevTasks);
    },
    onSettled: (_d, _e, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
    },
  });
}

export type ReorderUpdate = ReparentUpdate;

export function useReorderWorkItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; updates: ReorderUpdate[] }) => {
      for (const u of input.updates) {
        const patch: { position: number; parent_id?: string | null } = { position: u.position };
        if (u.parent_id !== undefined) patch.parent_id = u.parent_id;
        const { error } = await supabase
          .from('work_items')
          .update(patch)
          .eq('id', u.id);
        if (error) throw error;
      }
    },
    onMutate: async (input) => {
      markLocalWorkItemMutation();
      await Promise.all([
        qc.cancelQueries({ queryKey: workItemsKey(input.project_id) }),
        qc.cancelQueries({ queryKey: tasksDataKey }),
      ]);
      const map = new Map(input.updates.map((u) => [u.id, u]));
      const apply = (wi: WorkItem): WorkItem => {
        const u = map.get(wi.id);
        if (!u) return wi;
        return {
          ...wi,
          position: u.position,
          ...(u.parent_id !== undefined ? { parent_id: u.parent_id } : {}),
        } as WorkItem;
      };
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (prev) qc.setQueryData<WorkItem[]>(workItemsKey(input.project_id), prev.map(apply));
      const prevTasks = patchTasksCache(qc, (items) => items.map(apply));
      return { prev, prevTasks };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
      restoreTasksCache(qc, ctx?.prevTasks);
    },
    // A reparent re-runs the rollup trigger on both the old and new parent, so
    // both caches refetch to pick up the summaries' new dates and progress.
    onSettled: (_d, _e, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
    },
  });
}

export function useDeleteWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase.rpc('soft_delete_work_item', { p_id: input.id });
      if (error) throw error;
    },
    // The RPC is recursive, so drop the whole subtree optimistically — otherwise
    // children linger on screen until the refetch lands.
    onMutate: async (input) => {
      markLocalWorkItemMutation();
      await qc.cancelQueries({ queryKey: tasksDataKey });
      const prevTasks = patchTasksCache(qc, (items) => {
        const doomed = collectSubtreeIds(items, input.id);
        return items.filter((w) => !doomed.has(w.id));
      });
      return { prevTasks };
    },
    onError: (_e, _input, ctx) => restoreTasksCache(qc, ctx?.prevTasks),
    onSettled: (_d, _e, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: dependenciesKey(input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
      qc.invalidateQueries({ queryKey: deletedWorkItemsKey });
    },
  });
}

export function useRestoreWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase.rpc('restore_work_item', { p_id: input.id });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
      qc.invalidateQueries({ queryKey: deletedWorkItemsKey });
    },
  });
}

// Everything an optimistic cascade needs for one project, after cancelling
// in-flight refetches that would overwrite it.
async function cascadeContext(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  markLocalWorkItemMutation();
  await Promise.all([
    qc.cancelQueries({ queryKey: workItemsKey(projectId) }),
    qc.cancelQueries({ queryKey: dependenciesKey(projectId) }),
    qc.cancelQueries({ queryKey: tasksDataKey }),
  ]);
  const prev = qc.getQueryData<WorkItem[]>(workItemsKey(projectId));
  const prevDeps = qc.getQueryData<Dependency[]>(dependenciesKey(projectId));
  const tasks = findTasksData(qc, projectId);

  // The project caches are cold when this runs from the global Tasks page
  // without the drawer open. The Tasks dataset carries the same rows, edges
  // and calendar for every project, so the cascade runs from it instead —
  // otherwise the new dates would not show until something refetched,
  // because these mutations deliberately never invalidate.
  const items = prev ?? tasks?.items.filter((w) => w.project_id === projectId);
  const dependencies =
    prevDeps ?? tasks?.dependencies.filter((d) => d.project_id === projectId) ?? [];

  const project = qc.getQueryData<Project>(projectKey(projectId));
  const nonWorking = qc.getQueryData<NonWorkingDay[]>(nonWorkingDaysKey(projectId));
  const calendar =
    (!project || !nonWorking ? tasks?.calendarByProject.get(projectId) : undefined) ??
    buildCalendar(project?.working_days ?? [1, 2, 3, 4, 5], nonWorking ?? []);

  return { prev, prevDeps, items, dependencies, calendar };
}

export function useRescheduleFrom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; work_item_id: string; new_start: string; new_end: string }) => {
      const { error } = await supabase.rpc('reschedule_from', {
        p_work_item_id: input.work_item_id,
        p_new_start: input.new_start,
        p_new_end: input.new_end,
      });
      if (error) throw error;
    },
    onMutate: async (input) => {
      const { prev, prevDeps, items, dependencies, calendar } = await cascadeContext(qc, input.project_id);
      if (!items) return { prev, prevDeps, prevTasks: undefined };

      const result = computeCascade({
        rootId: input.work_item_id,
        newStart: input.new_start,
        newEnd: input.new_end,
        items,
        dependencies,
        calendar,
      });

      const applyCascade = (wi: WorkItem) => {
        const p = result.patches.get(wi.id);
        return p ? ({ ...wi, ...p } as WorkItem) : wi;
      };

      if (prev) qc.setQueryData<WorkItem[]>(workItemsKey(input.project_id), prev.map(applyCascade));
      // Same patch set on the global cache, so a date edited from the Tasks page
      // moves there too. The cascade is authoritative (it mirrors the server), so
      // like the project cache this is deliberately not invalidated afterwards.
      const prevTasks = patchTasksCache(qc, (items) => items.map(applyCascade));

      return { prev, prevDeps, prevTasks };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
      if (ctx?.prevDeps) qc.setQueryData(dependenciesKey(input.project_id), ctx.prevDeps);
      restoreTasksCache(qc, ctx?.prevTasks);
    },
    onSuccess: () => {
      markLocalWorkItemMutation();
    },
    // No onSettled invalidate — optimistic cascade + lag IS authoritative; matches server exactly.
  });
}

// Commit a parent to a date range, or clear it (null/null) so it fits its
// sub-tasks again. The parent's dates become the envelope of the range and its
// children, and successors cascade off them exactly like a date edit.
export function useSetPlannedRange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      work_item_id: string;
      planned_start: string | null;
      planned_end: string | null;
    }) => {
      const { error } = await supabase.rpc('set_planned_range', {
        p_work_item_id: input.work_item_id,
        p_start: input.planned_start,
        p_end: input.planned_end,
      });
      if (error) throw error;
    },
    onMutate: async (input) => {
      const { prev, prevDeps, items, dependencies, calendar } = await cascadeContext(qc, input.project_id);
      if (!items) return { prev, prevDeps, prevTasks: undefined };

      const range = { planned_start: input.planned_start, planned_end: input.planned_end };
      const withRange = items.map((w) => (w.id === input.work_item_id ? { ...w, ...range } : w));
      const { start_date, end_date } = rollupDates(
        range,
        withRange.filter((w) => w.parent_id === input.work_item_id),
      );
      const patches = new Map<string, Partial<WorkItem>>();
      // Server: set_planned_range only runs reschedule_from when both dates exist.
      if (start_date && end_date) {
        const result = computeCascade({
          rootId: input.work_item_id,
          newStart: start_date,
          newEnd: end_date,
          items: withRange,
          dependencies,
          calendar,
        });
        for (const [id, p] of result.patches) patches.set(id, p);
      }
      patches.set(input.work_item_id, {
        ...(patches.get(input.work_item_id) ?? {}),
        ...range,
        start_date,
        end_date,
      });

      const apply = (wi: WorkItem) => {
        const p = patches.get(wi.id);
        return p ? ({ ...wi, ...p } as WorkItem) : wi;
      };
      if (prev) qc.setQueryData<WorkItem[]>(workItemsKey(input.project_id), prev.map(apply));
      const prevTasks = patchTasksCache(qc, (items) => items.map(apply));

      return { prev, prevDeps, prevTasks };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
      if (ctx?.prevDeps) qc.setQueryData(dependenciesKey(input.project_id), ctx.prevDeps);
      restoreTasksCache(qc, ctx?.prevTasks);
    },
    onSuccess: () => {
      markLocalWorkItemMutation();
    },
    // Like useRescheduleFrom: the optimistic cascade mirrors the server, so no invalidate.
  });
}
