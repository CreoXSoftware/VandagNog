import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Dependency, DependencyType, Project, WorkItem } from '@/types/db';
import { computeCascade, computeSuccessorPositionFromDep } from '@/lib/cascade';
import { markLocalWorkItemMutation } from '@/lib/localMutationGuard';
import { workItemsKey } from './useWorkItems';
import { projectKey } from './useProjects';

export const dependenciesKey = (projectId: string) => ['dependencies', projectId] as const;

export function useDependencies(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? dependenciesKey(projectId) : ['dependencies', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<Dependency[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('dependencies').select('*').eq('project_id', projectId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      predecessor_id: string;
      successor_id: string;
      type: DependencyType;
      lag_days: number;
    }): Promise<Dependency> => {
      const { data, error } = await supabase.from('dependencies').insert(input).select().single();
      if (error) throw error;
      return data as Dependency;
    },
    onSuccess: (d) => qc.invalidateQueries({ queryKey: dependenciesKey(d.project_id) }),
  });
}

export function useUpdateDependency() {
  const qc = useQueryClient();
  const pendingReschedRef = useRef<{ id: string; start: string; end: string } | null>(null);
  return useMutation({
    mutationFn: async (input: {
      id: string;
      project_id: string;
      patch: Partial<Pick<Dependency, 'type' | 'lag_days'>>;
    }) => {
      const { error } = await supabase.from('dependencies').update(input.patch).eq('id', input.id);
      if (error) throw error;
      const r = pendingReschedRef.current;
      pendingReschedRef.current = null;
      if (r) {
        const { error: re } = await supabase.rpc('reschedule_from', {
          p_work_item_id: r.id,
          p_new_start: r.start,
          p_new_end: r.end,
        });
        if (re) throw re;
      }
    },
    onMutate: async (input) => {
      markLocalWorkItemMutation();
      await Promise.all([
        qc.cancelQueries({ queryKey: dependenciesKey(input.project_id) }),
        qc.cancelQueries({ queryKey: workItemsKey(input.project_id) }),
      ]);
      const prevDeps = qc.getQueryData<Dependency[]>(dependenciesKey(input.project_id));
      const prev = qc.getQueryData<WorkItem[]>(workItemsKey(input.project_id));
      if (!prevDeps || !prev) return { prevDeps, prev };

      const dep = prevDeps.find((d) => d.id === input.id);
      if (!dep) return { prevDeps, prev };
      const updatedDep: Dependency = { ...dep, ...input.patch };

      qc.setQueryData<Dependency[]>(
        dependenciesKey(input.project_id),
        prevDeps.map((d) => (d.id === input.id ? updatedDep : d)),
      );

      const pred = prev.find((w) => w.id === dep.predecessor_id);
      const succ = prev.find((w) => w.id === dep.successor_id);
      if (pred && succ) {
        const project = qc.getQueryData<Project>(projectKey(input.project_id));
        const workingSet = new Set(project?.working_days ?? [1, 2, 3, 4, 5]);
        const pos = computeSuccessorPositionFromDep(updatedDep, pred, succ, workingSet);
        if (pos && (pos.newStart !== succ.start_date || pos.newEnd !== succ.end_date)) {
          const result = computeCascade({
            rootId: succ.id,
            newStart: pos.newStart,
            newEnd: pos.newEnd,
            items: prev,
            dependencies: prevDeps,
            workingDays: workingSet,
          });
          qc.setQueryData<WorkItem[]>(
            workItemsKey(input.project_id),
            prev.map((wi) => {
              const p = result.patches.get(wi.id);
              return p ? ({ ...wi, ...p } as WorkItem) : wi;
            }),
          );
          pendingReschedRef.current = { id: succ.id, start: pos.newStart, end: pos.newEnd };
        }
      }

      return { prevDeps, prev };
    },
    onError: (_e, input, ctx) => {
      pendingReschedRef.current = null;
      if (ctx?.prevDeps) qc.setQueryData(dependenciesKey(input.project_id), ctx.prevDeps);
      if (ctx?.prev) qc.setQueryData(workItemsKey(input.project_id), ctx.prev);
    },
    onSuccess: () => markLocalWorkItemMutation(),
  });
}

export function useDeleteDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase.from('dependencies').delete().eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: dependenciesKey(input.project_id) }),
  });
}
