import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AppNotification } from '@/types/db';

export const notificationsKey = ['notifications'] as const;

export function useNotifications() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*, project:projects(name)')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const rows = (data ?? []) as AppNotification[];

      const actorIds = Array.from(
        new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v)),
      );
      if (actorIds.length === 0) return rows;

      const { data: actors } = await supabase
        .from('user_settings')
        .select('user_id, first_name, last_name')
        .in('user_id', actorIds);
      const byId = new Map<string, { first_name: string | null; last_name: string | null }>();
      for (const a of actors ?? []) byId.set(a.user_id, { first_name: a.first_name, last_name: a.last_name });

      return rows.map((r) => ({
        ...r,
        actor: r.actor_id ? byId.get(r.actor_id) ?? null : null,
      }));
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  });
}

export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`user:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: notificationsKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
