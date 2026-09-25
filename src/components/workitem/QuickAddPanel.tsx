import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkItem } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { useCreateWorkItem } from '@/hooks/useWorkItems';
import { useT } from '@/lib/i18n';
import { levelLabel } from '@/lib/levels';
import { JsonSyncPanel } from '@/components/tasks/JsonSyncPanel';
import { useTasksData } from '@/hooks/useTasksData';

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
  selected: WorkItem | undefined;
  onClose: () => void;
  onLastCreated: (id: string) => void;
}

type Mode = 'outline' | 'json';

export function QuickAddPanel({ projectId, selected, onClose, onLastCreated }: Props) {
  const t = useT();
  const create = useCreateWorkItem();
  const { data: tasksData } = useTasksData();

  const [mode, setMode] = useState<Mode>('outline');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const scope = useMemo(() => {
    if (selected) {
      return { parentId: selected.id, baseLevel: selected.level + 1 };
    }
    return { parentId: null as string | null, baseLevel: 0 };
  }, [selected]);

  async function submitOutline() {
    const parsed = parseQuickAdd(text);
    if (parsed.length === 0) {
      toast.error(t('workItem.quickAddEmpty'));
      return;
    }
    setBusy(true);
    try {
      const stack: { depth: number; id: string | null }[] = [{ depth: -1, id: scope.parentId }];
      let lastId: string | null = null;
      for (const line of parsed) {
        while (stack[stack.length - 1].depth >= line.depth) stack.pop();
        const parentId = stack[stack.length - 1].id;
        const r = await create.mutateAsync({
          project_id: projectId,
          parent_id: parentId,
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
    ? t('workItem.quickAddUnder', { name: selected.name, level: levelLabel(scope.baseLevel) })
    : t('workItem.quickAddRoot');

  const tabBase = 'px-2 py-1 text-xs rounded border';
  const tabActive = 'bg-neutral-200 dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100';
  const tabIdle = 'bg-transparent border-transparent text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800';

  return (
    <div className="p-3 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('outline')}
          className={`${tabBase} ${mode === 'outline' ? tabActive : tabIdle}`}
          disabled={busy}
        >
          {t('workItem.quickAddTabOutline')}
        </button>
        <button
          type="button"
          onClick={() => setMode('json')}
          className={`${tabBase} ${mode === 'json' ? tabActive : tabIdle}`}
          disabled={busy}
        >
          {t('workItem.quickAddTabJson')}
        </button>
      </div>

      {mode === 'outline' ? (
        <>
          <div className="text-xs text-neutral-600 dark:text-neutral-400">{scopeLabel}</div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                submitOutline();
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
            <Button size="sm" onClick={submitOutline} disabled={busy}>
              <Plus size={14} /> {t('workItem.quickAddSubmit')}
            </Button>
          </div>
        </>
      ) : tasksData ? (
        // Exactly the same engine the Tasks page uses: duplicate detection,
        // in-place updates and removals, locked to this project.
        <JsonSyncPanel data={tasksData} lockedProjectId={projectId} onDone={onClose} />
      ) : (
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('common.loading')}</div>
      )}
    </div>
  );
}
