import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TimeEntry } from '@/types/db';

export const timeEntriesKey = ['time_entries'] as const;
export const myTimeEntriesKey = (since: string | null) =>
  ['time_entries', 'mine', since ?? 'all'] as const;
export const reportEntriesKey = (since: string, until: string) =>
  ['time_entries', 'report', since, until] as const;
export const activeTimerKey = ['time_entries', 'active'] as const;

// --- Queries -----------------------------------------------------------------

// Own entries, optionally limited to since (inclusive). Used by the Tracking page.
export function useMyTimeEntries(opts: { since?: string | null } = {}) {
  const since = opts.since ?? null;
  return useQuery({
    queryKey: myTimeEntriesKey(since),
    queryFn: async (): Promise<TimeEntry[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      let q = supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', u.user.id)
        .order('start_at', { ascending: false });
      if (since) q = q.gte('start_at', since);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });
}

// The (at most one) running entry for me.
export function useActiveTimer() {
  return useQuery({
    queryKey: activeTimerKey,
    queryFn: async (): Promise<TimeEntry | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', u.user.id)
        .is('end_at', null)
        .maybeSingle();
      if (error) throw error;
      return (data as TimeEntry) ?? null;
    },
  });
}

// Reporting query — RLS already restricts to projects I'm a member of (plus my own).
export function useReportEntries(opts: { since: string; until: string }) {
  const { since, until } = opts;
  return useQuery({
    queryKey: reportEntriesKey(since, until),
    queryFn: async (): Promise<TimeEntry[]> => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .gte('start_at', since)
        .lt('start_at', until)
        .not('end_at', 'is', null)
        .order('start_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });
}

// --- Mutations ---------------------------------------------------------------

export interface StartTimerInput {
  project_id: string;
  work_item_id?: string | null;
  custom_task_text?: string | null;
  notes?: string | null;
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartTimerInput): Promise<string> => {
      const { data, error } = await supabase.rpc('start_time_entry', {
        p_project_id: input.project_id,
        p_work_item_id: input.work_item_id ?? null,
        p_custom_task_text: input.custom_task_text ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: activeTimerKey });
      const prev = qc.getQueryData<TimeEntry | null>(activeTimerKey);
      const optimistic = {
        id: '__optimistic__',
        user_id: '__optimistic__',
        project_id: input.project_id,
        work_item_id: input.work_item_id ?? null,
        custom_task_text: input.custom_task_text ?? null,
        notes: input.notes ?? null,
        start_at: new Date().toISOString(),
        end_at: null,
      } as unknown as TimeEntry;
      qc.setQueryData(activeTimerKey, optimistic);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx && 'prev' in ctx) qc.setQueryData(activeTimerKey, ctx.prev ?? null);
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('stop_time_entry');
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: activeTimerKey });
      const prev = qc.getQueryData<TimeEntry | null>(activeTimerKey);
      qc.setQueryData(activeTimerKey, null);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx && 'prev' in ctx) qc.setQueryData(activeTimerKey, ctx.prev ?? null);
    },
    onSettled: () => invalidateAll(qc),
  });
}

export interface ManualEntryInput {
  project_id: string;
  work_item_id?: string | null;
  custom_task_text?: string | null;
  notes?: string | null;
  start_at: string; // ISO
  end_at: string;   // ISO
}

export function useCreateManualEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ManualEntryInput): Promise<TimeEntry> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('time_entries')
        .insert({
          user_id: u.user.id,
          project_id: input.project_id,
          work_item_id: input.work_item_id ?? null,
          custom_task_text: input.custom_task_text?.trim() || null,
          notes: input.notes?.trim() || null,
          start_at: input.start_at,
          end_at: input.end_at,
        })
        .select()
        .single();
      if (error) throw error;
      return data as TimeEntry;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export interface UpdateEntryInput {
  id: string;
  patch: Partial<{
    project_id: string;
    work_item_id: string | null;
    custom_task_text: string | null;
    notes: string | null;
    start_at: string;
    end_at: string | null;
  }>;
}

export function useUpdateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateEntryInput): Promise<TimeEntry> => {
      const { data, error } = await supabase
        .from('time_entries')
        .update(input.patch)
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data as TimeEntry;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: timeEntriesKey });
}

// --- Realtime ----------------------------------------------------------------

export function useTimeEntriesRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    // Unique channel name per subscriber — re-using the same name across
    // multiple mounted hooks (e.g. widget + page) triggers
    // "cannot add postgres_changes callbacks after subscribe()".
    const name = `time_entries_changes:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(name)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'time_entries' },
        () => qc.invalidateQueries({ queryKey: timeEntriesKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

// --- Recents (localStorage) --------------------------------------------------

const RECENTS_KEY = 'vn.tracker.recents';
const RECENTS_MAX = 8;

export interface RecentTarget {
  project_id: string;
  work_item_id: string | null;
  custom_task_text: string | null;
  used_at: number;
}

export function readRecents(): RecentTarget[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentTarget[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushRecent(t: Omit<RecentTarget, 'used_at'>) {
  if (typeof window === 'undefined') return;
  const cur = readRecents();
  const key = recentKey(t);
  const next: RecentTarget[] = [{ ...t, used_at: Date.now() }, ...cur.filter((r) => recentKey(r) !== key)];
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_MAX)));
}

function recentKey(t: { project_id: string; work_item_id: string | null; custom_task_text: string | null }): string {
  return `${t.project_id}|${t.work_item_id ?? ''}|${t.custom_task_text ?? ''}`;
}

export function useRecents(): RecentTarget[] {
  // Re-read on every render — cheap; localStorage only changes on our own writes.
  return useMemo(() => readRecents(), []);
}
