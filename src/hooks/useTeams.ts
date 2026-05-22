import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ProjectRole, Team, TeamMember, TeamRole, TeamSummary } from '@/types/db';

export const teamsKey = ['teams'] as const;
export const teamMembersKey = (teamId: string) => ['team_members', teamId] as const;

export function useMyTeams() {
  return useQuery({
    queryKey: teamsKey,
    queryFn: async (): Promise<TeamSummary[]> => {
      const { data, error } = await supabase.rpc('my_teams_list');
      if (error) throw error;
      return (data ?? []) as TeamSummary[];
    },
  });
}

export function useTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async (): Promise<Team | null> => {
      if (!teamId) return null;
      const { data, error } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();
      if (error) throw error;
      return (data as Team) ?? null;
    },
  });
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamId ? teamMembersKey(teamId) : ['team_members', 'none'],
    enabled: !!teamId,
    queryFn: async (): Promise<TeamMember[]> => {
      if (!teamId) return [];
      const { data, error } = await supabase.rpc('team_members_list', { p_team: teamId });
      if (error) throw error;
      return (data ?? []) as TeamMember[];
    },
  });
}

export function useMyTeamRole(teamId: string | undefined) {
  const { data: teams } = useMyTeams();
  return teams?.find((t) => t.id === teamId)?.my_role ?? null;
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string | null }) => {
      const { data, error } = await supabase.rpc('create_team', {
        p_name: input.name,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as Team;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('join_team_by_code', { p_code: code });
      if (error) throw error;
      return data as Team;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

export function useRegenerateInviteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { data, error } = await supabase.rpc('regenerate_team_invite_code', { p_team_id: teamId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, teamId) => {
      qc.invalidateQueries({ queryKey: teamsKey });
      qc.invalidateQueries({ queryKey: ['team', teamId] });
    },
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { team_id: string; user_id: string }) => {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('team_id', input.team_id)
        .eq('user_id', input.user_id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: teamMembersKey(input.team_id) });
      qc.invalidateQueries({ queryKey: teamsKey });
    },
  });
}

export function useUpdateTeamMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { team_id: string; user_id: string; role: TeamRole }) => {
      const { error } = await supabase
        .from('team_members')
        .update({ role: input.role })
        .eq('team_id', input.team_id)
        .eq('user_id', input.user_id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: teamMembersKey(input.team_id) }),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string | null }) => {
      const { error } = await supabase
        .from('teams')
        .update({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: teamsKey });
      qc.invalidateQueries({ queryKey: ['team', input.id] });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { error } = await supabase.from('teams').delete().eq('id', teamId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: teamsKey }),
  });
}

export function useAddTeamToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; team_id: string; role: ProjectRole }) => {
      const { data, error } = await supabase.rpc('add_team_to_project', {
        p_project_id: input.project_id,
        p_team_id: input.team_id,
        p_role: input.role,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: ['members', input.project_id] }),
  });
}

export function useAddUserToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project_id: string; user_id: string; role: ProjectRole }) => {
      const { error } = await supabase.rpc('add_user_to_project_from_team', {
        p_project_id: input.project_id,
        p_user_id: input.user_id,
        p_role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: ['members', input.project_id] }),
  });
}
