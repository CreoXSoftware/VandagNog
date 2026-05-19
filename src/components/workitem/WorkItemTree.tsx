import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, ListPlus } from 'lucide-react';
import type { WorkItem, WorkItemLevel } from '@/types/db';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCreateWorkItem, useDeleteWorkItem } from '@/hooks/useWorkItems';
import { cn, formatDate } from '@/lib/utils';
import { toast } from 'sonner';
import { useT, type TKey } from '@/lib/i18n';

const LEVELS: WorkItemLevel[] = ['epic', 'task', 'subtask'];

interface ParsedLine {
  depth: number;
  text: string;
}

function parseQuickAdd(input: string): ParsedLine[] {
  const raw = input.replace(/\r\n?/g, '\n').split('\n');
  const lines: { indent: number; text: string }[] = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    const m = line.match(/^([ \t]*)(.*)$/)!;
    let indent = 0;
    for (const ch of m[1]) indent += ch === '\t' ? 4 : 1;
    const text = m[2].replace(/^[-*+•]\s*/, '').trim();
    if (!text) continue;
    lines.push({ indent, text });
  }
  if (lines.length === 0) return [];
  const baseline = Math.min(...lines.map((l) => l.indent));
  const offsets = lines.map((l) => l.indent - baseline).filter((n) => n > 0);
  const unit = offsets.length === 0 ? 1 : Math.min(...offsets);
  return lines.map((l) => ({
    depth: Math.floor((l.indent - baseline) / unit),
    text: l.text,
  }));
}

interface Props {
  projectId: string;
  workItems: WorkItem[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onCreate: (id: string) => void;
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

export function WorkItemTree({ projectId, workItems, selectedId, onSelect, onCreate, canEdit }: Props) {
  const create = useCreateWorkItem();
  const tree = useMemo(() => buildTree(workItems), [workItems]);
  const t = useT();
  const [quickOpen, setQuickOpen] = useState(false);

  const selectedItem = useMemo(
    () => (selectedId ? workItems.find((w) => w.id === selectedId) : undefined),
    [selectedId, workItems],
  );

  async function addEpic() {
    try {
      const res = await create.mutateAsync({
        project_id: projectId,
        parent_id: null,
        level: 'epic',
        name: t(newLabelKey.epic),
      });
      onCreate(res.id);
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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setQuickOpen((v) => !v)}>
                <ListPlus size={14} /> {t('workItem.quickAdd')}
              </Button>
              <Button size="sm" onClick={addEpic} disabled={create.isPending}>
                <Plus size={14} /> {t('workItem.addEpic')}
              </Button>
            </div>
          )}
        </div>
        {canEdit && quickOpen && (
          <QuickAddPanel
            projectId={projectId}
            selected={selectedItem}
            onClose={() => setQuickOpen(false)}
            onLastCreated={(id) => onCreate(id)}
          />
        )}
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
            onCreate={onCreate}
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
  onCreate: (id: string) => void;
  projectId: string;
  canEdit: boolean;
}

const nextLevel: Record<WorkItemLevel, WorkItemLevel | null> = {
  epic: 'task',
  task: 'subtask',
  subtask: null,
};

function TreeRow({ node, depth, selectedId, onSelect, onCreate, projectId, canEdit }: RowProps) {
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
      onCreate(r.id);
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
          onCreate={onCreate}
          projectId={projectId}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}

interface QuickAddProps {
  projectId: string;
  selected: WorkItem | undefined;
  onClose: () => void;
  onLastCreated: (id: string) => void;
}

function QuickAddPanel({ projectId, selected, onClose, onLastCreated }: QuickAddProps) {
  const t = useT();
  const create = useCreateWorkItem();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const scope = useMemo(() => {
    if (selected?.level === 'epic') {
      return { baseLevel: 'task' as WorkItemLevel, parentId: selected.id, maxDepth: 1 };
    }
    if (selected?.level === 'task') {
      return { baseLevel: 'subtask' as WorkItemLevel, parentId: selected.id, maxDepth: 0 };
    }
    return { baseLevel: 'epic' as WorkItemLevel, parentId: null as string | null, maxDepth: 2 };
  }, [selected]);

  async function submit() {
    const parsed = parseQuickAdd(text);
    if (parsed.length === 0) {
      toast.error(t('workItem.quickAddEmpty'));
      return;
    }
    if (parsed.some((p) => p.depth > scope.maxDepth)) {
      toast.error(t('workItem.quickAddTooDeep'));
      return;
    }
    setBusy(true);
    try {
      const baseIdx = LEVELS.indexOf(scope.baseLevel);
      const stack: { depth: number; id: string | null }[] = [{ depth: -1, id: scope.parentId }];
      let lastId: string | null = null;
      for (const line of parsed) {
        while (stack[stack.length - 1].depth >= line.depth) stack.pop();
        const parentId = stack[stack.length - 1].id;
        const level = LEVELS[baseIdx + line.depth];
        const r = await create.mutateAsync({
          project_id: projectId,
          parent_id: parentId,
          level,
          name: line.text,
        });
        stack.push({ depth: line.depth, id: r.id });
        lastId = r.id;
      }
      toast.success(t('workItem.quickAddSuccess', { count: parsed.length }));
      setText('');
      if (lastId) onLastCreated(lastId);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = selected && scope.parentId
    ? t('workItem.quickAddUnder', { name: selected.name, level: t(`workItem.level.${scope.baseLevel}`) })
    : t('workItem.quickAddRoot');

  return (
    <div className="mb-3 p-3 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 space-y-2">
      <div className="text-xs text-neutral-600 dark:text-neutral-400">{scopeLabel}</div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const value = ta.value;
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const selSpansLines = value.slice(start, end).includes('\n');
            if (e.shiftKey) {
              const segStart = lineStart;
              const segEnd = end;
              const seg = value.slice(segStart, segEnd);
              const lines = seg.split('\n');
              let removedFirst = 0;
              const dedented = lines.map((l, i) => {
                if (l.startsWith('\t')) {
                  if (i === 0) removedFirst = 1;
                  return l.slice(1);
                }
                const m = l.match(/^ {1,2}/);
                if (m) {
                  if (i === 0) removedFirst = m[0].length;
                  return l.slice(m[0].length);
                }
                return l;
              }).join('\n');
              const newValue = value.slice(0, segStart) + dedented + value.slice(segEnd);
              const removedTotal = seg.length - dedented.length;
              setText(newValue);
              requestAnimationFrame(() => {
                ta.selectionStart = Math.max(segStart, start - removedFirst);
                ta.selectionEnd = Math.max(segStart, end - removedTotal);
              });
              return;
            }
            if (selSpansLines) {
              const segStart = lineStart;
              const segEnd = end;
              const seg = value.slice(segStart, segEnd);
              const indented = seg.replace(/^/gm, '\t');
              const newValue = value.slice(0, segStart) + indented + value.slice(segEnd);
              const addedFirst = 1;
              const addedTotal = indented.length - seg.length;
              setText(newValue);
              requestAnimationFrame(() => {
                ta.selectionStart = start + addedFirst;
                ta.selectionEnd = end + addedTotal;
              });
              return;
            }
            const newValue = value.slice(0, start) + '\t' + value.slice(end);
            setText(newValue);
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + 1;
            });
          }
        }}
        placeholder={t('workItem.quickAddPlaceholder')}
        rows={8}
        spellCheck={false}
        className="w-full font-mono text-sm rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 p-2 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-500 whitespace-pre"
      />
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          {t('workItem.quickAddHide')}
        </Button>
        <Button size="sm" onClick={submit} disabled={busy}>
          <Plus size={14} /> {t('workItem.quickAddSubmit')}
        </Button>
      </div>
    </div>
  );
}
