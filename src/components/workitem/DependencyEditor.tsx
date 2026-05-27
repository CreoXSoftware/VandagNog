import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DisabledHint } from '@/components/ui/DisabledHint';
import type { Dependency, DependencyType, WorkItem } from '@/types/db';
import { useCreateDependency, useDeleteDependency, useUpdateDependency } from '@/hooks/useDependencies';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { outlineNumbers } from '@/lib/levels';

interface Props {
  workItem: WorkItem;
  allItems: WorkItem[];
  dependencies: Dependency[];
  canEdit: boolean;
  onNavigate: (id: string) => void;
}

const NBSP = ' ';
const INDENT = NBSP.repeat(4);

export function DependencyEditor({ workItem, allItems, dependencies, canEdit, onNavigate }: Props) {
  const create = useCreateDependency();
  const del = useDeleteDependency();
  const update = useUpdateDependency();
  const t = useT();

  const [adding, setAdding] = useState<'pred' | 'succ' | null>(null);
  const [addId, setAddId] = useState('');
  const [addType, setAddType] = useState<DependencyType>('FS');
  const [addLag, setAddLag] = useState(0);

  const itemMap = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);
  const numbers = useMemo(() => outlineNumbers(allItems), [allItems]);

  const predecessors = dependencies.filter((d) => d.successor_id === workItem.id);
  const successors = dependencies.filter((d) => d.predecessor_id === workItem.id);

  const candidates = useMemo(
    () => allItems.filter((i) => i.id !== workItem.id && !i.deleted_at),
    [allItems, workItem.id],
  );

  // Tree-order rows for the picker: include non-leaf ancestors of candidates as
  // disabled header rows so the hierarchy reads correctly.
  const pickerRows = useMemo(() => {
    const candidateIds = new Set(candidates.map((c) => c.id));
    const byId = new Map(allItems.map((i) => [i.id, i] as const));
    const include = new Set<string>(candidateIds);
    for (const id of candidateIds) {
      let cur = byId.get(id);
      while (cur?.parent_id) {
        include.add(cur.parent_id);
        cur = byId.get(cur.parent_id);
      }
    }
    const items = allItems.filter((i) => include.has(i.id) && !i.deleted_at);
    function cmp(a: WorkItem, b: WorkItem): number {
      const an = (numbers.get(a.id) ?? '').split('.').map(Number);
      const bn = (numbers.get(b.id) ?? '').split('.').map(Number);
      const n = Math.min(an.length, bn.length);
      for (let i = 0; i < n; i++) if (an[i] !== bn[i]) return an[i] - bn[i];
      return an.length - bn.length;
    }
    items.sort(cmp);
    return items.map((i) => ({ item: i, selectable: candidateIds.has(i.id) }));
  }, [allItems, candidates, numbers]);

  async function add() {
    if (!addId || !adding) return;
    try {
      await create.mutateAsync({
        project_id: workItem.project_id,
        predecessor_id: adding === 'pred' ? addId : workItem.id,
        successor_id: adding === 'succ' ? addId : workItem.id,
        type: addType,
        lag_days: addLag,
      });
      setAdding(null);
      setAddId('');
      setAddLag(0);
      setAddType('FS');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <DepList
        label={t('dependencies.predecessors')}
        rows={predecessors}
        otherKey="predecessor_id"
        itemMap={itemMap}
        numbers={numbers}
        canEdit={canEdit}
        onNavigate={onNavigate}
        onDelete={(d) => del.mutate({ id: d.id, project_id: workItem.project_id })}
        onUpdate={(d, patch) => update.mutate({ id: d.id, project_id: workItem.project_id, patch })}
        onAdd={() => setAdding('pred')}
      />
      <DepList
        label={t('dependencies.successors')}
        rows={successors}
        otherKey="successor_id"
        itemMap={itemMap}
        numbers={numbers}
        canEdit={canEdit}
        onNavigate={onNavigate}
        onDelete={(d) => del.mutate({ id: d.id, project_id: workItem.project_id })}
        onUpdate={(d, patch) => update.mutate({ id: d.id, project_id: workItem.project_id, patch })}
        onAdd={() => setAdding('succ')}
      />
      {adding && (
        <div className="border border-neutral-200 dark:border-neutral-700 rounded p-2 bg-neutral-50 dark:bg-neutral-900 space-y-2">
          <div className="text-[11px] text-neutral-600 dark:text-neutral-300">
            {adding === 'pred' ? t('dependencies.addPredecessor') : t('dependencies.addSuccessor')}
          </div>
          <Select value={addId} onChange={(e) => setAddId(e.target.value)} className="w-full">
            <option value="">{t('dependencies.selectItem')}</option>
            {pickerRows.map(({ item: c, selectable }) => (
              <option key={c.id} value={c.id} disabled={!selectable}>
                {INDENT.repeat(c.level)}{numbers.get(c.id) ?? ''} · {c.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Select value={addType} onChange={(e) => setAddType(e.target.value as DependencyType)}>
              <option value="FS">FS</option>
              <option value="FF">FF</option>
              <option value="SS">SS</option>
              <option value="SF">SF</option>
            </Select>
            <Input
              type="number"
              value={addLag}
              onChange={(e) => setAddLag(Number(e.target.value))}
              placeholder={t('dependencies.lagPlaceholder')}
              className="w-24"
            />
            <Button size="sm" onClick={add} disabled={!addId || create.isPending}>{t('common.add')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LagInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const timerRef = useRef<number | null>(null);
  useEffect(() => setV(String(value)), [value]);
  useEffect(() => () => { if (timerRef.current != null) window.clearTimeout(timerRef.current); }, []);

  function tryCommit(text: string) {
    if (text.trim() === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return;
    if (n === value) return;
    onCommit(n);
  }

  function handleChange(next: string) {
    setV(next);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      tryCommit(next);
    }, 400);
  }

  function flush() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    tryCommit(v);
    if (Number(v) !== value && !Number.isFinite(Number(v))) setV(String(value));
  }

  return (
    <Input
      type="number"
      value={v}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          if (timerRef.current != null) window.clearTimeout(timerRef.current);
          setV(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-6 w-12 text-[10px] px-1"
    />
  );
}

interface DepListProps {
  label: string;
  rows: Dependency[];
  otherKey: 'predecessor_id' | 'successor_id';
  itemMap: Map<string, WorkItem>;
  numbers: Map<string, string>;
  canEdit: boolean;
  onNavigate: (id: string) => void;
  onDelete: (d: Dependency) => void;
  onUpdate: (d: Dependency, patch: Partial<Pick<Dependency, 'type' | 'lag_days'>>) => void;
  onAdd: () => void;
}

function DepList({ label, rows, otherKey, itemMap, numbers, canEdit, onNavigate, onDelete, onUpdate, onAdd }: DepListProps) {
  const t = useT();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-neutral-600 dark:text-neutral-300">{label} ({rows.length})</span>
        {canEdit && (
          <button onClick={onAdd} className="text-blue-600 dark:text-blue-400 text-[11px] hover:underline flex items-center gap-0.5">
            <Plus size={11} /> {t('common.add')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{t('common.none')}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((d) => {
            const other = itemMap.get(d[otherKey]);
            if (!other) {
              return (
                <div key={d.id} className="flex items-center gap-1.5 text-xs">
                  <span className="flex-1 text-[11px] italic text-neutral-400 dark:text-neutral-500 truncate">
                    {t('dependencies.deletedItem')}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => onDelete(d)}
                      className="p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                      title={t('common.remove')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div key={d.id} className="flex items-center gap-1.5 text-xs">
                <Badge kind={other.level}>L{other.level + 1}</Badge>
                <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0">{numbers.get(other.id) ?? ''}</span>
                <button onClick={() => onNavigate(other.id)} className="flex-1 text-left text-blue-600 dark:text-blue-400 hover:underline truncate">
                  {other.name}
                </button>
                <DisabledHint
                  disabled={!canEdit}
                  reason={canEdit ? null : t('workItem.permReason')}
                >
                  <Select
                    value={d.type}
                    disabled={!canEdit}
                    onChange={(e) =>
                      onUpdate(d, { type: e.target.value as Dependency['type'] })
                    }
                    className="h-6 text-[10px] px-1"
                  >
                    <option value="FS">FS</option>
                    <option value="FF">FF</option>
                    <option value="SS">SS</option>
                    <option value="SF">SF</option>
                  </Select>
                </DisabledHint>
                <DisabledHint
                  disabled={!canEdit}
                  reason={canEdit ? null : t('workItem.permReason')}
                >
                  <LagInput
                    value={d.lag_days}
                    disabled={!canEdit}
                    onCommit={(v) => onUpdate(d, { lag_days: v })}
                  />
                </DisabledHint>
                {canEdit && (
                  <button
                    onClick={() => onDelete(d)}
                    className="p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400"
                    title={t('common.remove')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
