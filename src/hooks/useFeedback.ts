import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FeatureRequest, FeedbackPriority, FeedbackStatus, FeedbackType } from '@/types/db';

// Prefix of every feedback list.
export const feedbackKey = ['feature_requests'] as const;
export const orgFeedbackKey = (orgId: string) => ['feature_requests', 'org', orgId] as const;
export const myFeedbackKey = (userId: string) => ['feature_requests', 'mine', userId] as const;

// Requests sent to an org. RLS decides what that means: owners/admins get all
// of them, everyone else only their own.
export function useOrgFeedback(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: orgId ? orgFeedbackKey(orgId) : ['feature_requests', 'org', 'none'],
    enabled: !!orgId && enabled,
    queryFn: async (): Promise<FeatureRequest[]> => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('feature_requests')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });
}

// Everything I sent, to any org. For the Personal org, which can't receive
// feedback itself.
export function useMyFeedback(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: userId ? myFeedbackKey(userId) : ['feature_requests', 'mine', 'none'],
    enabled: !!userId && enabled,
    queryFn: async (): Promise<FeatureRequest[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('feature_requests')
        .select('*')
        .eq('submitted_by', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });
}

export interface NewFeedback {
  org_id: string;
  type: FeedbackType;
  title: string;
  description: string;
  steps_to_reproduce?: string | null;
  priority?: FeedbackPriority | null;
}

// submitted_by and status are filled in by the database (the client may not
// set them).
export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewFeedback) => {
      const isBug = input.type === 'bug';
      const { data, error } = await supabase
        .from('feature_requests')
        .insert({
          org_id: input.org_id,
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

/** The status update reached no row: not an owner/admin of the request's org. */
export class FeedbackForbiddenError extends Error {
  constructor() {
    super('Not allowed to change the status of this request');
    this.name = 'FeedbackForbiddenError';
  }
}

// Owners/admins of the request's org only; status is the one editable column.
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
