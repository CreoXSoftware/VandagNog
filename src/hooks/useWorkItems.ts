import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { WorkItem, WorkItemLevel } from '@/types/db';

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
  level: WorkItemLevel;
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
          level: input.level,
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
      await qc.cancelQueries({ queryKey: workItemsKey(input.project_id) });
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (prev) {
        qc.setQueryData<WorkItem[]>(
          workItemsKey(input.project_id),
          prev.map((wi) =>
            wi.id === input.work_item_id
              ? { ...wi, start_date: input.new_start, end_date: input.new_end }
              : wi,
          ),
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
