import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Comment } from '@/types/db';

export const commentsKey = (workItemId: string) => ['comments', workItemId] as const;

export function useComments(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemId ? commentsKey(workItemId) : ['comments', 'none'],
    enabled: !!workItemId,
    queryFn: async (): Promise<Comment[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('work_item_id', workItemId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      work_item_id: string;
      body: string;
      parent_comment_id?: string | null;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('comments')
        .insert({
          project_id: input.project_id,
          work_item_id: input.work_item_id,
          body: input.body,
          parent_comment_id: input.parent_comment_id ?? null,
          author_id: u.user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Comment;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: commentsKey(input.work_item_id) }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; work_item_id: string }) => {
      const { error } = await supabase
        .from('comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: commentsKey(input.work_item_id) }),
  });
}

export function useEditComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; work_item_id: string; body: string }) => {
      const { error } = await supabase
        .from('comments')
        .update({ body: input.body, edited_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) => qc.invalidateQueries({ queryKey: commentsKey(input.work_item_id) }),
  });
}
