import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DeletedProject, Project, ProjectUserPref } from '@/types/db';

export const projectsKey = ['projects'] as const;
export const deletedProjectsKey = ['projects', 'deleted'] as const;
export const projectKey = (id: string) => ['project', id] as const;
// Not under projectsKey: every project edit invalidates that prefix, and pins
// don't change when a project does.
export const projectPrefsKey = ['project_prefs'] as const;

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

// Marking a project completed is shared: it leaves the default "Active" list
// for every member. completed_by is stamped server-side by a trigger.
export function useSetProjectCompleted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from('projects')
        .update({ completed_at: input.completed ? new Date().toISOString() : null })
        .eq('id', input.id)
        // RLS filters a viewer's update to zero rows without an error; .single()
        // turns that into one instead of a silent no-op.
        .select('id')
        .single();
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: projectsKey });
      qc.invalidateQueries({ queryKey: projectKey(input.id) });
    },
  });
}

// My own pinned / hidden projects. RLS only ever returns my rows.
export function useProjectPrefs() {
  return useQuery({
    queryKey: projectPrefsKey,
    queryFn: async (): Promise<ProjectUserPref[]> => {
      const { data, error } = await supabase
        .from('project_user_prefs')
        .select('project_id,pinned_at,hidden_at');
      if (error) throw error;
      return (data ?? []) as ProjectUserPref[];
    },
  });
}

// Pin / unpin or hide / unhide one project for myself. Optimistic, because it
// reorders the list under the cursor and a round-trip delay reads as a miss.
export function useSetProjectPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; pinned?: boolean; hidden?: boolean }) => {
      const row: Record<string, unknown> = { project_id: input.projectId };
      const now = new Date().toISOString();
      if (input.pinned !== undefined) row.pinned_at = input.pinned ? now : null;
      if (input.hidden !== undefined) row.hidden_at = input.hidden ? now : null;
      // user_id defaults to auth.uid(); only the columns sent are overwritten
      // on conflict, so pinning leaves the hidden flag alone and vice versa.
      const { error } = await supabase
        .from('project_user_prefs')
        .upsert(row, { onConflict: 'user_id,project_id' });
      if (error) throw error;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: projectPrefsKey });
      const prev = qc.getQueryData<ProjectUserPref[]>(projectPrefsKey);
      const now = new Date().toISOString();
      qc.setQueryData<ProjectUserPref[]>(projectPrefsKey, (old = []) => {
        const cur = old.find((p) => p.project_id === input.projectId) ?? {
          project_id: input.projectId,
          pinned_at: null,
          hidden_at: null,
        };
        const next: ProjectUserPref = {
          ...cur,
          ...(input.pinned !== undefined && { pinned_at: input.pinned ? now : null }),
          ...(input.hidden !== undefined && { hidden_at: input.hidden ? now : null }),
        };
        return [...old.filter((p) => p.project_id !== input.projectId), next];
      });
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectPrefsKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: projectPrefsKey }),
  });
}
