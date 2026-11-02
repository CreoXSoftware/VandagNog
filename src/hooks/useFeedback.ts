import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { FeatureRequest, FeedbackPriority, FeedbackStatus, FeedbackType } from '@/types/db';

// Prefix of every feedback list.
export const feedbackKey = ['feature_requests'] as const;

// RLS decides what this is: app admins get every request, everyone else their
// own.
export function useFeedback() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...feedbackKey, user?.id],
    enabled: !!user,
    queryFn: async (): Promise<FeatureRequest[]> => {
      const { data, error } = await supabase
        .from('feature_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });
}

/** Am I an app admin (a developer of the app, who triages all feedback)? */
export function useIsAppAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['is_app_admin', user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('is_app_admin');
      if (error) throw error;
      return data === true;
    },
  });
}

export interface NewFeedback {
  type: FeedbackType;
  title: string;
  description: string;
  steps_to_reproduce?: string | null;
  priority?: FeedbackPriority | null;
}

// The sender, their org, and the status are filled in by the database (the
// client may not set them).
export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewFeedback) => {
      const isBug = input.type === 'bug';
      const { data, error } = await supabase
        .from('feature_requests')
        .insert({
          type: input.type,
          title: input.title,
          description: input.description,
          steps_to_reproduce: isBug ? input.steps_to_reproduce || null : null,
          priority: isBug ? input.priority ?? null : null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as FeatureRequest;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKey }),
  });
}

/** The status update reached no row: not an app admin. */
export class FeedbackForbiddenError extends Error {
  constructor() {
    super('Not allowed to change the status of this request');
    this.name = 'FeedbackForbiddenError';
  }
}

// App admins only; status is the one editable column.
export function useSetFeedbackStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: FeedbackStatus }) => {
      const { data, error } = await supabase
        .from('feature_requests')
        .update({ status: input.status })
        .eq('id', input.id)
        .select('id');
      if (error) throw error;
      // RLS turns a forbidden update into "0 rows" rather than an error.
      if (!data || data.length === 0) throw new FeedbackForbiddenError();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKey }),
  });
}
