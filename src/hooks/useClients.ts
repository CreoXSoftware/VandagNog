import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Client, ProjectClientInfo } from '@/types/db';
import { projectKey, projectsKey } from './useProjects';

// Prefix of every client list; the lists themselves are per organization.
export const clientsKey = ['clients'] as const;
export const orgClientsKey = (orgId: string) => ['clients', 'org', orgId] as const;
export const projectClientKey = (projectId: string) => ['project_client', projectId] as const;
// Under the 'project_client' prefix, so client renames refresh it too.
export const allProjectClientsKey = ['project_client', 'all'] as const;

// The clients of an organization (members see them all; a guest only those of
// projects shared with them).
export function useOrgClients(orgId: string | undefined) {
  return useQuery({
    queryKey: orgId ? orgClientsKey(orgId) : ['clients', 'none'],
    enabled: !!orgId,
    queryFn: async (): Promise<Client[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });
}

// Client linked to a project. Null if no client.
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

// Every visible project's client in one read, for the Projects list.
export function useAllProjectClients() {
  return useQuery({
    queryKey: allProjectClientsKey,
    queryFn: async (): Promise<Map<string, ProjectClientInfo>> => {
      const { data, error } = await supabase.from('project_client_view').select('*');
      if (error) throw error;
      return new Map(((data ?? []) as ProjectClientInfo[]).map((c) => [c.project_id, c]));
    },
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; org_id: string }) => {
      const { data, error } = await supabase.rpc('create_client', {
        p_name: input.name,
        p_org_id: input.org_id,
      });
      if (error) throw error;
      return data as Client;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: clientsKey }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: clientsKey }),
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
      qc.invalidateQueries({ queryKey: allProjectClientsKey });
      qc.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
