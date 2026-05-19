import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { WorkItem, WorkItemLevel } from '@/types/db';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCreateWorkItem, useDeleteWorkItem } from '@/hooks/useWorkItems';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { useT, type TKey } from '@/lib/i18n';

interface Props {
  projectId: string;
  workItems: WorkItem[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  canEdit: boolean;
}

interface TreeNode {
  item: WorkItem;
  children: TreeNode[];
}

function buildTree(items: WorkItem[]): TreeNode[] {
  const byParent = new Map<string | null, WorkItem[]>();
  for (const it of items) {
    const k = it.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  }
  function build(parentId: string | null): TreeNode[] {
    return (byParent.get(parentId) ?? [])
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map((item) => ({ item, children: build(item.id) }));
  }
  return build(null);
}

const newLabelKey: Record<WorkItemLevel, TKey> = {
  epic: 'workItem.newEpic',
  task: 'workItem.newTask',
  subtask: 'workItem.newSubtask',
};

export function WorkItemTree({ projectId, workItems, selectedId, onSelect, canEdit }: Props) {
  const create = useCreateWorkItem();
  const tree = useMemo(() => buildTree(workItems), [workItems]);
  const t = useT();

  async function addEpic() {
    try {
      const res = await create.mutateAsync({
        project_id: projectId,
        parent_id: null,
        level: 'epic',
        name: t(newLabelKey.epic),
      });
      onSelect(res.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('workItem.items', { count: workItems.length })}</div>
          {canEdit && (
            <Button size="sm" onClick={addEpic} disabled={create.isPending}>
              <Plus size={14} /> {t('workItem.addEpic')}
            </Button>
          )}
        </div>
        {tree.length === 0 && (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-12 text-center border border-dashed border-neutral-300 dark:border-neutral-700 rounded">
            {t('workItem.noItems')} {canEdit && t('workItem.addEpicToStart')}
          </div>
        )}
        {tree.map((n) => (
          <TreeRow
            key={n.item.id}
            node={n}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            projectId={projectId}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  projectId: string;
  canEdit: boolean;
}

const nextLevel: Record<WorkItemLevel, WorkItemLevel | null> = {
  epic: 'task',
  task: 'subtask',
  subtask: null,
};

function TreeRow({ node, depth, selectedId, onSelect, projectId, canEdit }: RowProps) {
  const [open, setOpen] = useState(true);
  const create = useCreateWorkItem();
  const del = useDeleteWorkItem();
  const childLevel = nextLevel[node.item.level];
  const t = useT();

  async function addChild() {
    if (!childLevel) return;
    try {
      const r = await create.mutateAsync({
        project_id: projectId,
        parent_id: node.item.id,
        level: childLevel,
        name: t(newLabelKey[childLevel]),
      });
      setOpen(true);
      onSelect(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(t('workItem.deleteConfirm', { level: t(`workItem.level.${node.item.level}`), name: node.item.name }))) return;
    try {
      await del.mutateAsync({ id: node.item.id, project_id: projectId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        onClick={() => onSelect(node.item.id)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer group',
          selectedId === node.item.id
            ? 'bg-blue-50 dark:bg-blue-950/40'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
        )}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={cn('p-0.5 text-neutral-400 dark:text-neutral-500', !hasChildren && 'invisible')}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Badge kind={node.item.level}>{t(`workItem.level.${node.item.level}`)}</Badge>
        <span className="flex-1 text-sm truncate">{node.item.name}</span>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 hidden md:block">
          {formatDate(node.item.start_date)} → {formatDate(node.item.end_date)}
        </span>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 w-9 text-right">{node.item.progress}%</span>
        {canEdit && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
            {childLevel && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addChild();
                }}
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-500 dark:text-neutral-400"
                title={t('workItem.addLevel', { level: t(`workItem.level.${childLevel}`) })}
              >
                <Plus size={12} />
              </button>
            )}
            <button
              onClick={remove}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-950 rounded text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              title={t('common.delete')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
      {open && node.children.map((c) => (
        <TreeRow
          key={c.item.id}
          node={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          projectId={projectId}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}
