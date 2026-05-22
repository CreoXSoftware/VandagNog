import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Client, ProjectClientInfo, VisibleClient } from '@/types/db';
import { projectKey, projectsKey } from './useProjects';

export const clientsKey = ['clients'] as const;
export const visibleClientsKey = ['clients', 'visible'] as const;
export const projectClientKey = (projectId: string) => ['project_client', projectId] as const;

// All clients in scopes I own/manage: my private + every team I'm in.
export function useMyClients() {
  return useQuery({
    queryKey: clientsKey,
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });
}

// Picker payload — same dataset annotated with scope/team_name from server.
export function useVisibleClients() {
  return useQuery({
    queryKey: visibleClientsKey,
    queryFn: async (): Promise<VisibleClient[]> => {
      const { data, error } = await supabase.rpc('my_visible_clients');
      if (error) throw error;
      return (data ?? []) as VisibleClient[];
    },
  });
}

// Client linked to a project, with scope label info. Null if no client.
export function useProjectClient(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectClientKey(projectId) : ['project_client', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectClientInfo | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('project_client_view')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return (data as ProjectClientInfo) ?? null;
    },
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; team_id?: string | null }) => {
      const { data, error } = await supabase.rpc('create_client', {
        p_name: input.name,
        p_team_id: input.team_id ?? null,
      });
      if (error) throw error;
      return data as Client;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKey });
      qc.invalidateQueries({ queryKey: visibleClientsKey });
    },
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      const { error } = await supabase
        .from('clients')
        .update({ name: input.name })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKey });
      qc.invalidateQueries({ queryKey: visibleClientsKey });
      qc.invalidateQueries({ queryKey: ['project_client'] });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKey });
      qc.invalidateQueries({ queryKey: visibleClientsKey });
    },
  });
}

export function usePromoteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { client_id: string; team_id: string }) => {
      const { data, error } = await supabase.rpc('promote_client_to_team', {
        p_client_id: input.client_id,
        p_team_id: input.team_id,
      });
      if (error) throw error;
      return data as Client;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKey });
      qc.invalidateQueries({ queryKey: visibleClientsKey });
      qc.invalidateQueries({ queryKey: ['project_client'] });
    },
  });
}

export function useSetProjectClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; client_id: string | null }) => {
      const { error } = await supabase.rpc('set_project_client', {
        p_project_id: input.project_id,
        p_client_id: input.client_id,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: projectClientKey(input.project_id) });
      qc.invalidateQueries({ queryKey: projectKey(input.project_id) });
      qc.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
