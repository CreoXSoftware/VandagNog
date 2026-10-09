import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ProjectInvite, ProjectMember, ProjectRole, ProjectTeam } from '@/types/db';

export const membersKey = (projectId: string) => ['members', projectId] as const;
export const projectTeamsKey = (projectId: string) => ['project_teams', projectId] as const;
export const invitesKey = (projectId: string) => ['invites', projectId] as const;

export function useMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? membersKey(projectId) : ['members', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectMember[]> => {
      if (!projectId) return [];

      // Primary path: RPC (carries email + first/last + display_name, gated by is_member)
      const rpcQ = await supabase.rpc('project_members_list', { p_project: projectId });

      if (!rpcQ.error && rpcQ.data && rpcQ.data.length > 0) {
        return rpcQ.data as ProjectMember[];
      }

      if (rpcQ.error) {
        console.warn('[useMembers] rpc failed, enriching from user_settings:', rpcQ.error.message);
      }

      // Fallback: raw project_members + user_settings (no email available)
      const memQ = await supabase.from('project_members').select('*').eq('project_id', projectId);
      if (memQ.error) throw memQ.error;
      const members = memQ.data ?? [];
      if (members.length === 0) return [];

      const ids = members.map((m) => m.user_id);
      const setQ = await supabase
        .from('user_settings')
        .select('user_id, first_name, last_name')
        .in('user_id', ids);
      const byId = new Map<string, { first_name: string | null; last_name: string | null }>();
      for (const r of setQ.data ?? []) byId.set(r.user_id, { first_name: r.first_name, last_name: r.last_name });

      return members.map((m) => {
        const s = byId.get(m.user_id);
        const full = [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim();
        return {
          ...m,
          first_name: s?.first_name ?? null,
          last_name: s?.last_name ?? null,
          display_name: full || undefined,
        };
      });
    },
  });
}

export function useMyRole(projectId: string | undefined) {
  const { data } = useMembers(projectId);
  return useQuery({
    queryKey: ['my_role', projectId],
    enabled: !!projectId && !!data,
    queryFn: async (): Promise<ProjectRole | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const m = (data ?? []).find((m) => m.user_id === u.user!.id);
      return m?.role ?? null;
    },
  });
}

// Upsert, not update: someone who is only in via a linked team has no
// project_members row yet, and giving them their own role creates one (a direct
// role overrides the team's, up or down).
export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; user_id: string; role: ProjectRole }) => {
      const { error } = await supabase
        .from('project_members')
        .upsert(
          { project_id: input.project_id, user_id: input.user_id, role: input.role },
          { onConflict: 'project_id,user_id' },
        );
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: membersKey(input.project_id) }),
  });
}

// Deletes the person's own project_members row. Anyone who is also in a linked
// team keeps access at the team's role; their task assignments never change.
export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; user_id: string }) => {
      const { error } = await supabase
        .from('project_members')
        .delete()
        .eq('project_id', input.project_id)
        .eq('user_id', input.user_id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: membersKey(input.project_id) }),
  });
}

export function useProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectTeamsKey(projectId) : ['project_teams', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectTeam[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('project_teams_list', { p_project: projectId });
      if (error) throw error;
      return (data ?? []) as ProjectTeam[];
    },
  });
}

export function useUpdateProjectTeamRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; team_id: string; role: ProjectRole }) => {
      const { error } = await supabase
        .from('project_teams')
        .update({ role: input.role })
        .eq('project_id', input.project_id)
        .eq('team_id', input.team_id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: projectTeamsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: membersKey(input.project_id) });
    },
  });
}

export function useUnlinkTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; team_id: string }) => {
      const { error } = await supabase
        .from('project_teams')
        .delete()
        .eq('project_id', input.project_id)
        .eq('team_id', input.team_id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: projectTeamsKey(input.project_id) });
      qc.invalidateQueries({ queryKey: membersKey(input.project_id) });
    },
  });
}

export function useInvites(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? invitesKey(projectId) : ['invites', 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectInvite[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_invites')
        .select('*')
        .eq('project_id', projectId)
        .is('accepted_at', null);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; email: string; role: ProjectRole }) => {
      const { data, error } = await supabase.rpc('create_invite', {
        p_project_id: input.project_id,
        p_email: input.email,
        p_role: input.role,
      });
      if (error) throw error;
      return data as { token: string };
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: invitesKey(input.project_id) }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await supabase.from('project_invites').delete().eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: invitesKey(input.project_id) }),
  });
}

export async function acceptInvite(token: string) {
  const { error } = await supabase.rpc('accept_invite', { p_token: token });
  if (error) throw error;
}
