import { useState, useMemo, useRef } from 'react';
import { formatDistanceToNow } from '@/lib/time';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { useComments, useCreateComment, useDeleteComment } from '@/hooks/useComments';
import { useAuth } from '@/hooks/useAuth';
import type { Comment, ProjectMember } from '@/types/db';
import { toast } from 'sonner';
import { Trash2, CornerDownRight } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { displayName } from '@/lib/userDisplay';
import { useT } from '@/lib/i18n';

interface Props {
  workItemId: string;
  projectId: string;
  members: ProjectMember[];
  canEdit: boolean;
}

export function CommentThread({ workItemId, projectId, members, canEdit }: Props) {
  const { data = [] } = useComments(workItemId);
  const create = useCreateComment();
  const del = useDeleteComment();
  const { user } = useAuth();
  const t = useT();

  const rootComments = data.filter((c) => !c.parent_comment_id);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of data) {
      if (c.parent_comment_id) {
        const arr = m.get(c.parent_comment_id) ?? [];
        arr.push(c);
        m.set(c.parent_comment_id, arr);
      }
    }
    return m;
  }, [data]);

  return (
    <div className="space-y-3 mt-1">
      {data.length === 0 && <div className="text-xs text-neutral-400 dark:text-neutral-500">{t('comments.none')}</div>}
      <div className="space-y-2">
        {rootComments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            members={members}
            replies={repliesByParent.get(c.id) ?? []}
            workItemId={workItemId}
            projectId={projectId}
            canEdit={canEdit}
            currentUserId={user?.id}
            onDelete={(id) => del.mutate({ id, work_item_id: workItemId })}
          />
        ))}
      </div>
      {canEdit && (
        <Composer
          placeholder={t('comments.writeComment')}
          members={members}
          onSubmit={async (body) => {
            try {
              await create.mutateAsync({ project_id: projectId, work_item_id: workItemId, body });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  members: ProjectMember[];
  replies: Comment[];
  workItemId: string;
  projectId: string;
  canEdit: boolean;
  currentUserId?: string;
  onDelete: (id: string) => void;
}

function CommentItem({ comment, members, replies, workItemId, projectId, canEdit, currentUserId, onDelete }: CommentItemProps) {
  const create = useCreateComment();
  const [replying, setReplying] = useState(false);
  const author = members.find((m) => m.user_id === comment.author_id);
  const isAuthor = currentUserId === comment.author_id;
  const isDeleted = !!comment.deleted_at;
  const t = useT();

  return (
    <div>
      <div className="flex gap-2 text-xs">
        <Avatar user={author} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{displayName(author)}</span>
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
              {comment.edited_at ? ` · ${t('comments.edited')}` : ''}
            </span>
            {isAuthor && !isDeleted && (
              <button
                onClick={() => onDelete(comment.id)}
                className="text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 ml-auto"
                title={t('common.delete')}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
          <div className="prose prose-sm max-w-none text-neutral-700 dark:text-neutral-200 dark:prose-invert">
            {isDeleted ? (
              <span className="italic text-neutral-400 dark:text-neutral-500">{t('comments.deleted')}</span>
            ) : (
              <ReactMarkdown>{renderMentions(comment.body, members)}</ReactMarkdown>
            )}
          </div>
          {canEdit && !isDeleted && (
            <button
              onClick={() => setReplying((v) => !v)}
              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline mt-0.5 flex items-center gap-0.5"
            >
              <CornerDownRight size={10} /> {t('comments.reply')}
            </button>
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <div className="ml-8 mt-2 space-y-2 border-l border-neutral-200 dark:border-neutral-800 pl-3">
          {replies.map((r) => (
            <ReplyItem
              key={r.id}
              comment={r}
              members={members}
              isAuthor={currentUserId === r.author_id}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {replying && (
        <div className="ml-8 mt-2">
          <Composer
            placeholder={t('comments.writeReply')}
            autoFocus
            members={members}
            onSubmit={async (body) => {
              try {
                await create.mutateAsync({
                  project_id: projectId,
                  work_item_id: workItemId,
                  body,
                  parent_comment_id: comment.id,
                });
                setReplying(false);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
    </div>
  );
}

function ReplyItem({ comment, members, isAuthor, onDelete }: { comment: Comment; members: ProjectMember[]; isAuthor: boolean; onDelete: (id: string) => void }) {
  const author = members.find((m) => m.user_id === comment.author_id);
  const isDeleted = !!comment.deleted_at;
  const t = useT();
  return (
    <div className="flex gap-2 text-xs">
      <Avatar user={author} size="xs" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">{displayName(author)}</span>
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
          </span>
          {isAuthor && !isDeleted && (
            <button
              onClick={() => onDelete(comment.id)}
              className="text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 ml-auto"
              title={t('common.delete')}
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
        <div className="prose prose-sm max-w-none text-neutral-700 dark:text-neutral-200 dark:prose-invert">
          {isDeleted ? (
            <span className="italic text-neutral-400 dark:text-neutral-500">{t('comments.deleted')}</span>
          ) : (
            <ReactMarkdown>{renderMentions(comment.body, members)}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}

interface ComposerProps {
  placeholder?: string;
  autoFocus?: boolean;
  members: ProjectMember[];
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}

function Composer({ placeholder, autoFocus, members, onSubmit, onCancel }: ComposerProps) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  const candidates = mentionQ === null ? [] : members.filter((m) =>
    `${displayName(m)} ${m.email ?? ''}`.toLowerCase().includes(mentionQ.toLowerCase()),
  ).slice(0, 5);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setBody(v);
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const match = before.match(/(^|\s)@([A-Za-z0-9_.\-]*)$/);
    setMentionQ(match ? match[2] : null);
  }

  function insertMention(m: ProjectMember) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([A-Za-z0-9_.\-]*)$/, '');
    const after = body.slice(caret);
    const label = displayName(m);
    const inserted = `@[${label}](${m.user_id}) `;
    const next = before + inserted + after;
    setBody(next);
    setMentionQ(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + inserted).length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={body}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={2}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      {mentionQ !== null && candidates.length > 0 && (
        <div className="absolute z-10 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-md rounded mt-1 w-56">
          {candidates.map((m) => (
            <button
              key={m.user_id}
              onClick={() => insertMention(m)}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
            >
              <Avatar user={m} size="xs" />
              <span className="truncate">{displayName(m)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-1">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        )}
        <Button size="sm" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? '…' : t('comments.send')}
        </Button>
      </div>
    </div>
  );
}

function renderMentions(body: string, members: ProjectMember[]): string {
  void members;
  // @[Name](user_id) → **@Name**
  return body.replace(/@\[([^\]]+)\]\([^)]+\)/g, (_m, name) => `**@${name}**`);
}
