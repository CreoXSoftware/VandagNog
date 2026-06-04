import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { WorkItemAttachment } from '@/types/db';

export const BUCKET = 'work-item-attachments';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const attachmentsKey = (workItemId: string) => ['attachments', workItemId] as const;

export function useAttachments(workItemId: string | undefined) {
  return useQuery({
    queryKey: workItemId ? attachmentsKey(workItemId) : ['attachments', 'none'],
    enabled: !!workItemId,
    queryFn: async (): Promise<WorkItemAttachment[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from('work_item_attachments')
        .select('*')
        .eq('work_item_id', workItemId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'file';
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      project_id: string;
      work_item_id: string;
      file: File;
    }): Promise<WorkItemAttachment> => {
      if (input.file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`File exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`);
      }
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not authenticated');

      const id = crypto.randomUUID();
      const safeName = sanitiseFilename(input.file.name);
      const path = `${input.project_id}/${input.work_item_id}/${id}-${safeName}`;

      const upload = await supabase.storage
        .from(BUCKET)
        .upload(path, input.file, {
          contentType: input.file.type || 'application/octet-stream',
          upsert: false,
        });
      if (upload.error) throw upload.error;

      const insert = await supabase
        .from('work_item_attachments')
        .insert({
          id,
          work_item_id: input.work_item_id,
          project_id: input.project_id,
          storage_path: path,
          file_name: input.file.name,
          file_size: input.file.size,
          mime_type: input.file.type || null,
          uploaded_by: u.user.id,
        })
        .select()
        .single();

      if (insert.error) {
        // best-effort cleanup — avoid orphan file in storage
        await supabase.storage.from(BUCKET).remove([path]);
        throw insert.error;
      }
      return insert.data as WorkItemAttachment;
    },
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: attachmentsKey(input.work_item_id) }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; work_item_id: string; storage_path: string }) => {
      const { error } = await supabase
        .from('work_item_attachments')
        .delete()
        .eq('id', input.id);
      if (error) throw error;
      // Row gone → orphan removal of the storage object. RLS allows
      // project members to delete, so this succeeds even if uploader differs.
      await supabase.storage.from(BUCKET).remove([input.storage_path]);
    },
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: attachmentsKey(input.work_item_id) }),
  });
}

export async function getAttachmentSignedUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error('No signed URL');
  return data.signedUrl;
}
