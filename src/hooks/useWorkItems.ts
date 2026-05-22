import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Dependency, NonWorkingDay, Project, WorkItem } from '@/types/db';
import { computeCascade, computeIncomingLagUpdates, type LagUpdate } from '@/lib/cascade';
import { buildCalendar } from '@/components/gantt/ganttUtils';
import { markLocalWorkItemMutation } from '@/lib/localMutationGuard';
import { dependenciesKey } from './useDependencies';
import { nonWorkingDaysKey } from './useNonWorkingDays';
import { projectKey } from './useProjects';

export const workItemsKey = (projectId: string) => ['work_items', projectId] as const;

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
  project_id: string;
  parent_id: string | null;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  position?: number;
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
          project_id: input.project_id,
          parent_id: input.parent_id,
          name: input.name,
          start_date: input.start_date ?? null,
          end_date: input.end_date ?? null,
          position: input.position ?? 0,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as WorkItem;
    },
    onSuccess: (data) => qc.invalidateQueries({ queryKey: workItemsKey(data.project_id) }),
  });
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
      await qc.cancelQueries({ queryKey: workItemsKey(input.project_id) });
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (prev) {
        qc.setQueryData<WorkItem[]>(
          workItemsKey(input.project_id),
          prev.map((wi) => (wi.id === input.id ? { ...wi, ...input.patch } as WorkItem : wi)),
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
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) }),
  });
}

export function useRestoreWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase.rpc('restore_work_item', { p_id: input.id });
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: workItemsKey(input.project_id) }),
  });
}

export function useRescheduleFrom() {
  const qc = useQueryClient();
  const pendingLagUpdatesRef = useRef<LagUpdate[]>([]);
  return useMutation({
    mutationFn: async (input: { project_id: string; work_item_id: string; new_start: string; new_end: string }) => {
      const { error } = await supabase.rpc('reschedule_from', {
        p_work_item_id: input.work_item_id,
        p_new_start: input.new_start,
        p_new_end: input.new_end,
      });
      if (error) throw error;

      const lagUpdates = pendingLagUpdatesRef.current;
      pendingLagUpdatesRef.current = [];
      for (const u of lagUpdates) {
        const { error: depErr } = await supabase
          .from('dependencies')
          .update({ lag_days: u.lag_days })
          .eq('id', u.id);
        if (depErr) throw depErr;
      }
    },
    onMutate: async (input) => {
      markLocalWorkItemMutation();
      await Promise.all([
        qc.cancelQueries({ queryKey: workItemsKey(input.project_id) }),
        qc.cancelQueries({ queryKey: dependenciesKey(input.project_id) }),
      ]);
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      const prevDeps = qc.getQueryData<Dependency[]>(dependenciesKey(input.project_id)) ?? [];
      if (!prev) return { prev, prevDeps };

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

      const lagUpdates = computeIncomingLagUpdates({
        rootId: input.work_item_id,
        newStart: input.new_start,
        newEnd: input.new_end,
        items: prev,
        dependencies: prevDeps,
        calendar,
      });
      pendingLagUpdatesRef.current = lagUpdates;

      qc.setQueryData<WorkItem[]>(
        workItemsKey(input.project_id),
        prev.map((wi) => {
          const p = result.patches.get(wi.id);
          return p ? ({ ...wi, ...p } as WorkItem) : wi;
        }),
      );

      if (lagUpdates.length > 0) {
        const lagMap = new Map(lagUpdates.map((u) => [u.id, u.lag_days]));
        qc.setQueryData<Dependency[]>(
          dependenciesKey(input.project_id),
          prevDeps.map((d) => {
            const lag = lagMap.get(d.id);
            return lag != null ? { ...d, lag_days: lag } : d;
          }),
        );
      }

      return { prev, prevDeps };
    },
    onError: (_e, input, ctx) => {
      pendingLagUpdatesRef.current = [];
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
      if (ctx?.prevDeps) qc.setQueryData(dependenciesKey(input.project_id), ctx.prevDeps);
    },
    onSuccess: () => {
      markLocalWorkItemMutation();
    },
    // No onSettled invalidate — optimistic cascade + lag IS authoritative; matches server exactly.
  });
}
