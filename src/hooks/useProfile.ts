import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserSettings } from '@/types/db';

export const profileKey = (userId: string | undefined) => ['profile', userId ?? 'none'] as const;

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKey(userId),
    enabled: !!userId,
    queryFn: async (): Promise<UserSettings | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

interface ProfilePatch {
  first_name?: string | null;
  last_name?: string | null;
  notifications_enabled?: boolean;
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; patch: ProfilePatch }) => {
      const row = { user_id: input.user_id, ...input.patch, updated_at: new Date().toISOString() };
      const { data, error } = await supabase
        .from('user_settings')
        .upsert(row, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return data as UserSettings;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: profileKey(input.user_id) });
      // Member lists derived from this user's name need refresh.
      qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}
