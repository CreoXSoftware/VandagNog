import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { NonWorkingDay } from '@/types/db';

export const nonWorkingDaysKey = (projectId: string) =>
  ['non_working_days', projectId] as const;

export function useNonWorkingDays(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? nonWorkingDaysKey(projectId) : ['non_working_days', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<NonWorkingDay[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('non_working_days')
        .select('*')
        .eq('project_id', projectId)
        .order('start_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateNonWorkingDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
    }): Promise<NonWorkingDay> => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('non_working_days')
        .insert({ ...input, created_by: userId })
        .select()
        .single();
      if (error) throw error;
      return data as NonWorkingDay;
    },
    onSuccess: (d) =>
      qc.invalidateQueries({ queryKey: nonWorkingDaysKey(d.project_id) }),
  });
}

export function useUpdateNonWorkingDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      project_id: string;
      patch: Partial<Pick<NonWorkingDay, 'start_date' | 'end_date' | 'reason'>>;
    }) => {
      const { error } = await supabase
        .from('non_working_days')
        .update(input.patch)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: nonWorkingDaysKey(input.project_id) }),
  });
}

export function useDeleteNonWorkingDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase
        .from('non_working_days')
        .delete()
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: nonWorkingDaysKey(input.project_id) }),
  });
}
