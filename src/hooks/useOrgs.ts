import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { OrgMember, OrgProjectMember, OrgRole, Organization } from '@/types/db';

export const orgsKey = ['orgs'] as const;
export const orgMembersKey = (orgId: string) => ['org_members', orgId] as const;
export const orgProjectMembersKey = (orgId: string) => ['org_project_members', orgId] as const;

const ORG_RANK: Record<OrgRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

/** Is `role` at least `min`? guest < member < admin < owner. */
export function orgRoleAtLeast(role: OrgRole | null | undefined, min: OrgRole): boolean {
  return !!role && ORG_RANK[role] >= ORG_RANK[min];
}

// Every org I'm in, guests included: shared orgs by name, then my Personal one.
// Everyone gets a personal org when they sign up; if it is somehow missing,
// it is created here so there is always somewhere to put a project.
export function useMyOrgs() {
  return useQuery({
    queryKey: orgsKey,
    queryFn: async (): Promise<Organization[]> => {
      const { data, error } = await supabase.rpc('my_orgs_list');
      if (error) throw error;
      const orgs = (data ?? []) as Organization[];
      if (orgs.some((o) => o.is_personal)) return orgs;
      const made = await supabase.rpc('my_personal_org');
      if (made.error) throw made.error;
      const again = await supabase.rpc('my_orgs_list');
      if (again.error) throw again.error;
      return (again.data ?? []) as Organization[];
    },
  });
}

// The people of an org with their own project roles. Members only: the server
// returns nothing to a guest.
export function useOrgMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: orgId ? orgMembersKey(orgId) : ['org_members', 'none'],
    enabled: !!orgId,
    queryFn: async (): Promise<OrgMember[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase.rpc('org_members_list', { p_org: orgId });
      if (error) throw error;
      return (data ?? []) as OrgMember[];
    },
  });
}

// Everyone's effective role on every project of the org I can see — one call
// instead of project_members_list per project. Also the only way to get names
// and emails of people who never filled in a profile.
export async function fetchOrgProjectMembers(orgId: string): Promise<OrgProjectMember[]> {
  const { data, error } = await supabase.rpc('org_project_members', { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as OrgProjectMember[];
}

function useInvalidateOrgs() {
  const qc = useQueryClient();
  return (orgId?: string) => {
    qc.invalidateQueries({ queryKey: orgsKey });
    if (orgId) {
      qc.invalidateQueries({ queryKey: orgMembersKey(orgId) });
      qc.invalidateQueries({ queryKey: orgProjectMembersKey(orgId) });
    }
  };
}

export function useCreateOrg() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string | null }) => {
      const { data, error } = await supabase.rpc('create_organization', {
        p_name: input.name,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as { id: string; name: string };
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateOrg() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: async (input: { id: string; name: string; description: string | null }) => {
      const { error } = await supabase.rpc('update_organization', {
        p_org: input.id,
        p_name: input.name,
        p_description: input.description,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => invalidate(input.id),
  });
}

export function useDeleteOrg() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc('delete_organization', { p_org: orgId });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}

export function useJoinOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('join_org_by_code', { p_code: code.trim() });
      if (error) throw error;
      return data as { id: string; name: string };
    },
    // A guest who joins now sees every project of the org: refresh it all.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRegenerateOrgCode() {
  const invalidate = useInvalidateOrgs();
  return useMutation({
    mutationFn: async (orgId: string) => {
      const { data, error } = await supabase.rpc('regenerate_org_invite_code', { p_org: orgId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, orgId) => invalidate(orgId),
  });
}

// A role change can widen or narrow project access across the whole org.
export function useSetOrgMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { org_id: string; user_id: string; role: OrgRole }) => {
      const { error } = await supabase.rpc('set_org_member_role', {
        p_org: input.org_id,
        p_user: input.user_id,
        p_role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// Removing someone (or leaving) also ends their own roles in the org's
// projects; their task assignments stay.
export function useRemoveOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { org_id: string; user_id: string }) => {
      const { error } = await supabase.rpc('remove_org_member', {
        p_org: input.org_id,
        p_user: input.user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
