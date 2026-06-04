import { useRef, useState, type DragEvent } from 'react';
import { Paperclip, Download, Trash2, FileIcon, ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';
import { formatDistanceToNow } from '@/lib/time';
import {
  MAX_ATTACHMENT_BYTES,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
  getAttachmentSignedUrl,
} from '@/hooks/useAttachments';
import type { WorkItemAttachment } from '@/types/db';

interface Props {
  workItemId: string;
  projectId: string;
  canEdit: boolean;
}

export function AttachmentsSection({ workItemId, projectId, canEdit }: Props) {
  const t = useT();
  const { user } = useAuth();
  const { data = [] } = useAttachments(workItemId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inflight, setInflight] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t('attachments.tooLarge', { name: file.name }));
        continue;
      }
      setInflight((n) => n + 1);
      try {
        await upload.mutateAsync({ project_id: projectId, work_item_id: workItemId, file });
      } catch (e) {
        toast.error(`${t('attachments.uploadFailed')}: ${(e as Error).message}`);
      } finally {
        setInflight((n) => n - 1);
      }
    }
  }

  function onPick() {
    fileInputRef.current?.click();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length) void handleFiles(files);
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!canEdit) return;
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
  }

  async function onDownload(a: WorkItemAttachment) {
    try {
      const url = await getAttachmentSignedUrl(a.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(`${t('attachments.downloadFailed')}: ${(e as Error).message}`);
    }
  }

  function onDelete(a: WorkItemAttachment) {
    if (!window.confirm(t('attachments.deleteConfirm'))) return;
    del.mutate(
      { id: a.id, work_item_id: a.work_item_id, storage_path: a.storage_path },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  return (
    <div
      className={
        'mt-1 rounded border border-dashed transition-colors ' +
        (dragOver
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
          : 'border-transparent')
      }
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {data.length === 0 && inflight === 0 && (
        <div className="text-xs text-neutral-400 dark:text-neutral-500 px-1 py-1">
          {t('attachments.empty')}
        </div>
      )}

      <div className="space-y-1">
        {data.map((a) => {
          const canDelete = canEdit && (a.uploaded_by === user?.id);
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm"
            >
              <FileTypeIcon mime={a.mime_type} />
              <button
                onClick={() => onDownload(a)}
                className="flex-1 min-w-0 text-left truncate text-neutral-800 dark:text-neutral-100 hover:underline"
                title={a.file_name}
              >
                {a.file_name}
              </button>
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                {formatBytes(a.file_size)}
              </span>
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
              </span>
              <button
                onClick={() => onDownload(a)}
                className="text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400"
                title={t('attachments.download')}
              >
                <Download size={12} />
              </button>
              {canDelete && (
                <button
                  onClick={() => onDelete(a)}
                  className="text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                  title={t('common.delete')}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}

        {inflight > 0 && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Loader2 size={12} className="animate-spin" />
            {t('attachments.uploading')} ({inflight})
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 mt-2 px-1">
          <Button size="sm" variant="outline" onClick={onPick}>
            <Paperclip size={12} /> {t('attachments.add')}
          </Button>
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
            {t('attachments.dropHint')}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onInputChange}
          />
        </div>
      )}
    </div>
  );
}

function FileTypeIcon({ mime }: { mime: string | null }) {
  const isImage = !!mime && mime.startsWith('image/');
  const Icon = isImage ? ImageIcon : FileIcon;
  return <Icon size={14} className="text-neutral-400 dark:text-neutral-500 shrink-0" />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
