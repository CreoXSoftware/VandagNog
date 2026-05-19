import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Dependency, DependencyType } from '@/types/db';

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
  return useMutation({
    mutationFn: async (input: {
      id: string;
      project_id: string;
      patch: Partial<Pick<Dependency, 'type' | 'lag_days'>>;
    }) => {
      const { error } = await supabase.from('dependencies').update(input.patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: dependenciesKey(input.project_id) }),
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
