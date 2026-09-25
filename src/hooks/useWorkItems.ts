import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Dependency, NonWorkingDay, Project, WorkItem } from '@/types/db';
import { computeCascade } from '@/lib/cascade';
import { buildCalendar } from '@/components/gantt/ganttUtils';
import { markLocalWorkItemMutation } from '@/lib/localMutationGuard';
import { dependenciesKey } from './useDependencies';
import { nonWorkingDaysKey } from './useNonWorkingDays';
import { projectKey } from './useProjects';
import { tasksDataKey, type TasksData } from './useTasksData';
import { collectSubtreeIds } from '@/lib/workItemTree';

export const workItemsKey = (projectId: string) => ['work_items', projectId] as const;

// The global Tasks page holds every work item in one cache entry, so a
// project-scoped mutation has to patch it too or the row won't move until the
// next refetch. These helpers keep that cache in step without making the
// mutations depend on the page being mounted (they no-op when it isn't).
function patchTasksCache(
  qc: ReturnType<typeof useQueryClient>,
  apply: (items: WorkItem[]) => WorkItem[],
): TasksData | undefined {
  const prev = qc.getQueryData<TasksData>(tasksDataKey);
  if (prev) qc.setQueryData<TasksData>(tasksDataKey, { ...prev, items: apply(prev.items) });
  return prev;
}

function restoreTasksCache(
  qc: ReturnType<typeof useQueryClient>,
  prev: TasksData | undefined,
): void {
  if (prev) qc.setQueryData<TasksData>(tasksDataKey, prev);
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
  // rejects anyone else.
  assignee_id?: string | null;
}

export function useCreateWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkItemInput): Promise<WorkItem> => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
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
          assignee_id: input.assignee_id ?? null,
          created_by: userId,
        })
        .select()
        .single();
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
      const optimistic = provisionalWorkItem(input, input.id);
      const prevTasks = patchTasksCache(qc, (items) => [...items, optimistic]);
      return { prevTasks };
    },
    onError: (_e, _input, ctx) => restoreTasksCache(qc, ctx?.prevTasks),
    onSettled: (data, _e, input) => {
      qc.invalidateQueries({ queryKey: workItemsKey(data?.project_id ?? input.project_id) });
      qc.invalidateQueries({ queryKey: tasksDataKey });
    },
  });
}

// A stand-in row shaped like what the server will return. level is 0 because
// optimistic creates are always root-level (see QuickAddRow); the DB trigger
// owns the real value and the refetch corrects anything that differs.
function provisionalWorkItem(input: CreateWorkItemInput, id: string): WorkItem {
  const now = new Date().toISOString();
  return {
    id,
    project_id: input.project_id,
    parent_id: input.parent_id,
    level: 0,
    name: input.name,
    description: input.description ?? null,
    deliverable: input.deliverable ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    duration_days: input.duration_days ?? null,
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

export interface ReorderUpdate {
  id: string;
  position: number;
  parent_id?: string | null;
}

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
      await qc.cancelQueries({ queryKey: workItemsKey(input.project_id) });
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (prev) {
        const map = new Map(input.updates.map((u) => [u.id, u]));
        qc.setQueryData<WorkItem[]>(
          workItemsKey(input.project_id),
          prev.map((wi) => {
            const u = map.get(wi.id);
            if (!u) return wi;
            return {
              ...wi,
              position: u.position,
              ...(u.parent_id !== undefined ? { parent_id: u.parent_id } : {}),
            } as WorkItem;
          }),
        );
      }
      return { prev };
    },
    onError: (_e, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
    },
    onSettled: (_d, _e, input) => qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) }),
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
    },
  });
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
      markLocalWorkItemMutation();
      await Promise.all([
        qc.cancelQueries({ queryKey: workItemsKey(input.project_id) }),
        qc.cancelQueries({ queryKey: dependenciesKey(input.project_id) }),
      ]);
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      const prevDeps = qc.getQueryData<Dependency[]>(dependenciesKey(input.project_id)) ?? [];
      if (!prev) return { prev, prevDeps, prevTasks: undefined };

      const project = qc.getQueryData<Project>(projectKey(input.project_id));
      const nonWorking = qc.getQueryData<NonWorkingDay[]>(nonWorkingDaysKey(input.project_id)) ?? [];
      const calendar = buildCalendar(project?.working_days ?? [1, 2, 3, 4, 5], nonWorking);

      const result = computeCascade({
        rootId: input.work_item_id,
        newStart: input.new_start,
        newEnd: input.new_end,
        items: prev,
        dependencies: prevDeps,
        calendar,
      });

      const applyCascade = (wi: WorkItem) => {
        const p = result.patches.get(wi.id);
        return p ? ({ ...wi, ...p } as WorkItem) : wi;
      };

      qc.setQueryData<WorkItem[]>(workItemsKey(input.project_id), prev.map(applyCascade));
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
