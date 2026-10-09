import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DeletedProject, Project } from '@/types/db';

export const projectsKey = ['projects'] as const;
export const deletedProjectsKey = ['projects', 'deleted'] as const;
export const projectKey = (id: string) => ['project', id] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: id ? projectKey(id) : ['project', 'none'],
    enabled: !!id,
    queryFn: async (): Promise<Project | null> => {
      if (!id) return null;
      const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }): Promise<Project> => {
      const { data, error } = await supabase.rpc('create_project', {
        p_name: input.name,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as Project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectsKey });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<Project> }) => {
      const { data, error } = await supabase
        .from('projects')
        .update(input.patch)
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: projectsKey });
      qc.invalidateQueries({ queryKey: projectKey(data.id) });
    },
  });
}

// Soft delete: the project and everything in it disappear for all members
// (is_member is false while deleted) but nothing is removed, so it can be
// restored. Owner only. Invalidates everything because tasks, workload,
// tracker and client lists all include rows from the project.
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_project', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('restore_project', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// Deleted projects the current user owns, newest first.
export function useDeletedProjects() {
  return useQuery({
    queryKey: deletedProjectsKey,
    queryFn: async (): Promise<DeletedProject[]> => {
      const { data, error } = await supabase.rpc('deleted_projects_list');
      if (error) throw error;
      return (data ?? []) as DeletedProject[];
    },
  });
}
