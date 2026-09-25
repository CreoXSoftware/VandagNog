import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, FileUp, ClipboardCopy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { buildTemplateClipboardText } from '@/lib/bulkImportTemplate';
import {
  applySyncDiff,
  buildSyncDiff,
  parseSyncDoc,
  removalRoots,
  type ParsedScope,
  type SyncDiff,
} from '@/lib/bulkSync';
import { workItemsKey } from '@/hooks/useWorkItems';
import { dependenciesKey } from '@/hooks/useDependencies';
import { tasksDataKey, type TasksData } from '@/hooks/useTasksData';
import type { WorkItem } from '@/types/db';

interface Props {
  data: TasksData;
  /**
   * Restricts the panel to one project: a document without project identity
   * targets it automatically, and scopes for other projects are ignored. Used by
   * the project Quick Add panel, where the destination is never in question.
   */
  lockedProjectId?: string;
  onDone?: () => void;
}

// The whole import/sync flow — load a document, preview the diff, apply it.
// Shared so the global Tasks dialog and the project Quick Add panel behave
// identically; the only difference is whether a project is pre-selected.
export function JsonSyncPanel({ data, lockedProjectId, onDone }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ParsedScope[] | null>(null);
  const [target, setTarget] = useState(lockedProjectId ?? '');
  const [applyCreate, setApplyCreate] = useState(true);
  const [applyUpdate, setApplyUpdate] = useState(true);
  // Removals are destructive and recursive — never on by default.
  const [applyRemove, setApplyRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // A v1 document carries no project identity, so it needs a destination.
  const needsTarget = !lockedProjectId && !!scopes?.some((s) => !s.projectId && !s.projectName);

  const editableProjects = useMemo(
    () => data.projects.filter((p) => data.editableProjectIds.has(p.id)),
    [data.projects, data.editableProjectIds],
  );

  const diff: SyncDiff | null = useMemo(() => {
    if (!scopes) return null;
    if (needsTarget && !target) return null;
    const full = buildSyncDiff({
      scopes,
      items: data.items,
      dependencies: data.dependencies,
      projects: data.projects,
      people: data.people,
      membership: data.membership,
      fallbackProjectId: target || lockedProjectId || null,
    });
    if (!lockedProjectId) return full;
    // Locked to one project: never let a multi-project file touch anything else.
    const kept = full.projects.filter((p) => p.projectId === lockedProjectId);
    const dropped = full.projects.filter((p) => p.projectId !== lockedProjectId);
    return {
      ...full,
      projects: kept,
      unresolved: [
        ...full.unresolved,
        ...dropped.map((p) => ({
          projectId: p.projectId,
          projectName: p.projectName,
          taskCount: p.flat.length,
        })),
      ],
      totals: kept.reduce(
        (acc, p) => ({
          create: acc.create + p.create.length,
          matched: acc.matched + p.matched.length,
          update: acc.update + p.update.length,
          remove: acc.remove + p.remove.length,
          ambiguous: acc.ambiguous + p.ambiguous.length,
        }),
        { create: 0, matched: 0, update: 0, remove: 0, ambiguous: 0 },
      ),
    };
  }, [scopes, needsTarget, target, lockedProjectId, data]);

  function reset() {
    setText('');
    setErrors([]);
    setScopes(null);
    setTarget(lockedProjectId ?? '');
    setApplyCreate(true);
    setApplyUpdate(true);
    setApplyRemove(false);
    setProgress(null);
  }

  function analyse() {
    const res = parseSyncDoc(text);
    if (!res.ok) {
      setErrors(res.errors);
      setScopes(null);
      return;
    }
    setErrors([]);
    setScopes(res.scopes);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setScopes(null);
      setErrors([]);
    };
    reader.onerror = () => toast.error((reader.error as Error)?.message ?? 'Failed to read file');
    reader.readAsText(file);
  }

  async function copyTemplate() {
    const payload = buildTemplateClipboardText();
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(t('tasks.sync.copied'));
    } catch {
      const ta = document.createElement('textarea');
      ta.value = payload;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast.success(t('tasks.sync.copied'));
    }
  }

  async function apply() {
    if (!diff || busy) return;
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('Not authenticated');

      const res = await applySyncDiff({
        diff,
        applyCreate,
        applyUpdate,
        applyRemove,
        calendarFor: (projectId) =>
          data.calendarByProject.get(projectId) ?? {
            weekly: new Set([1, 2, 3, 4, 5]),
            nonWorking: new Set<string>(),
          },
        // Direct writes rather than the mutation hooks: those invalidate on
        // every call, which would trigger a refetch per row on a large import.
        // One invalidation happens at the end instead.
        createWorkItem: async (input) => {
          const { data: row, error } = await supabase
            .from('work_items')
            .insert({
              project_id: input.project_id,
              parent_id: input.parent_id,
              name: input.name,
              description: input.description ?? null,
              deliverable: input.deliverable ?? null,
              start_date: input.start_date ?? null,
              end_date: input.end_date ?? null,
              duration_days: input.duration_days ?? null,
              progress: input.progress ?? 0,
              position: input.position ?? 0,
              assignee_id: input.assignee_id ?? null,
              created_by: userId,
            })
            .select('id')
            .single();
          if (error) throw error;
          return row as { id: string };
        },
        createDependency: async (input) => {
          const { error } = await supabase.from('dependencies').insert(input);
          if (error) throw error;
        },
        updateWorkItem: async (id, patch) => {
          const { error } = await supabase.from('work_items').update(patch).eq('id', id);
          if (error) throw error;
        },
        deleteWorkItem: async (id) => {
          const { error } = await supabase.rpc('soft_delete_work_item', { p_id: id });
          if (error) throw error;
        },
        rescheduleProject: async (projectId) => {
          const { error } = await supabase.rpc('reschedule_project', { p_project_id: projectId });
          if (error) throw error;
        },
        onProgress: (done, total) => setProgress({ done, total }),
      });

      // The RPCs and raw writes bypass the query cache entirely.
      await Promise.all([
        qc.invalidateQueries({ queryKey: tasksDataKey }),
        ...diff.projects.flatMap((p) => [
          qc.invalidateQueries({ queryKey: workItemsKey(p.projectId) }),
          qc.invalidateQueries({ queryKey: dependenciesKey(p.projectId) }),
        ]),
      ]);

      if (res.errors.length > 0) {
        toast.error(t('tasks.sync.partial', { n: res.errors.length }), {
          description: res.errors.slice(0, 3).join('\n'),
        });
      } else {
        toast.success(
          t('tasks.sync.done', {
            created: res.created,
            updated: res.updated,
            removed: res.removed,
          }),
        );
      }
      reset();
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const nothingToDo =
    !!diff &&
    diff.totals.create === 0 &&
    diff.totals.update === 0 &&
    diff.totals.remove === 0 &&
    diff.totals.ambiguous === 0;
  const canApply =
    !!diff &&
    !busy &&
    ((applyCreate && diff.totals.create > 0) ||
      (applyUpdate && diff.totals.update > 0) ||
      (applyRemove && diff.totals.remove > 0));

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('tasks.sync.intro')}</p>

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onPickFile}
          className="hidden"
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp size={13} />
          {t('tasks.sync.pickFile')}
        </Button>
        <Button size="sm" variant="ghost" onClick={copyTemplate}>
          <ClipboardCopy size={13} />
          {t('tasks.sync.copyTemplate')}
        </Button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setScopes(null);
          setErrors([]);
        }}
        placeholder={t('tasks.sync.placeholder')}
        className="min-h-[120px] font-mono text-[11px]"
      />

      {errors.length > 0 && (
        <div className="rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-2">
          <div className="text-xs font-medium text-red-700 dark:text-red-300">
            {t('tasks.sync.errorsTitle')}
          </div>
          <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {errors.map((err, i) => (
              <li key={i} className="text-[11px] text-red-600 dark:text-red-400">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {needsTarget && (
        <div className="space-y-1">
          <label className="text-xs font-medium">{t('tasks.sync.targetProject')}</label>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full">
            <option value="">—</option>
            {editableProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {t('tasks.sync.targetHint')}
          </div>
        </div>
      )}

      {diff && <DiffSummary diff={diff} />}

      {diff && nothingToDo && (
        <div className="text-xs text-emerald-700 dark:text-emerald-400">
          {t('tasks.sync.noChanges')}
        </div>
      )}

      {diff && !nothingToDo && (
        <div className="space-y-1.5 border-t border-neutral-200 dark:border-neutral-800 pt-3">
          <Toggle
            checked={applyCreate}
            onChange={setApplyCreate}
            disabled={diff.totals.create === 0}
            label={`${t('tasks.sync.applyCreate')} (${diff.totals.create})`}
          />
          <Toggle
            checked={applyUpdate}
            onChange={setApplyUpdate}
            disabled={diff.totals.update === 0}
            label={`${t('tasks.sync.applyUpdate')} (${diff.totals.update})`}
          />
          <Toggle
            checked={applyRemove}
            onChange={setApplyRemove}
            disabled={diff.totals.remove === 0}
            label={`${t('tasks.sync.applyRemove')} (${diff.totals.remove})`}
          />
          {applyRemove && (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {t('tasks.sync.removeWarning')}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {progress && progress.total > 0 && (
          <span className="mr-auto text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            {progress.done} / {progress.total}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            reset();
            onDone?.();
          }}
        >
          {t('tasks.sync.cancel')}
        </Button>
        {!diff ? (
          <Button size="sm" onClick={analyse} disabled={!text.trim()}>
            {t('tasks.sync.analyse')}
          </Button>
        ) : (
          <Button size="sm" onClick={apply} disabled={!canApply}>
            {busy ? t('tasks.sync.applying') : t('tasks.sync.apply')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-xs select-none',
        disabled ? 'opacity-50' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}

function DiffSummary({ diff }: { diff: SyncDiff }) {
  const t = useT();
  const touched = diff.projects.filter(
    (p) => p.create.length > 0 || p.update.length > 0 || p.remove.length > 0 || p.ambiguous.length > 0,
  );

  return (
    <div className="rounded border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
      <div className="flex items-center gap-3 px-3 py-2 text-[11px] flex-wrap">
        <span className="font-medium">{t('tasks.sync.summary')}</span>
        <Stat label={t('tasks.sync.statNew')} n={diff.totals.create} tone="emerald" />
        <Stat label={t('tasks.sync.statUpdate')} n={diff.totals.update} tone="blue" />
        <Stat label={t('tasks.sync.statMatched')} n={diff.totals.matched} tone="neutral" />
        <Stat label={t('tasks.sync.statRemove')} n={diff.totals.remove} tone="red" />
        {diff.totals.ambiguous > 0 && (
          <Stat label={t('tasks.sync.statAmbiguous')} n={diff.totals.ambiguous} tone="amber" />
        )}
      </div>

      <div className="max-h-56 overflow-y-auto">
        {touched.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">—</div>
        )}
        {touched.map((p) => {
          const roots = p.remove.length > 0 ? removalRoots(p.remove) : [];
          return (
            <div key={p.projectId} className="px-3 py-2">
              <div className="text-xs font-medium truncate">{p.projectName}</div>
              {p.create.length > 0 && (
                <NameList
                  tone="emerald"
                  label={t('tasks.sync.createLabel')}
                  names={p.create.map((c) => c.name)}
                />
              )}
              {p.update.length > 0 && (
                <NameList
                  tone="blue"
                  label={t('tasks.sync.updateLabel')}
                  names={p.update.map(
                    (u) =>
                      `${u.existing.name} (${t('tasks.sync.changedFields', {
                        fields: u.changed.map(fieldLabel).join(', '),
                      })})`,
                  )}
                />
              )}
              {roots.length > 0 && (
                <NameList
                  tone="red"
                  label={t('tasks.sync.removeLabel')}
                  names={roots.map((r) => {
                    const name = p.remove.find((w) => w.id === r.id)?.name ?? r.id;
                    return r.covers > 1
                      ? `${name} (${t('tasks.sync.subtreeWarning', { n: r.covers - 1 })})`
                      : name;
                  })}
                />
              )}
              {p.ambiguous.length > 0 && (
                <>
                  <NameList
                    tone="amber"
                    label={t('tasks.sync.ambiguousLabel')}
                    names={p.ambiguous.map((a) => a.task.name)}
                  />
                  <div className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                    {t('tasks.sync.ambiguousHint')}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {diff.warnings.length > 0 && (
        <div className="px-3 py-2 space-y-0.5 max-h-24 overflow-y-auto">
          {diff.warnings.slice(0, 8).map((w, i) => (
            <div key={i} className="text-[11px] text-amber-700 dark:text-amber-400">
              {w}
            </div>
          ))}
          {diff.warnings.length > 8 && (
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
              +{diff.warnings.length - 8}
            </div>
          )}
        </div>
      )}

      {diff.unresolved.length > 0 && (
        <div className="px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {t('tasks.sync.unresolvedLabel')}:{' '}
          {diff.unresolved.map((u) => u.projectName ?? u.projectId).join(', ')}
        </div>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  start_date: 'start',
  end_date: 'end',
  assignee_id: 'assignee',
  duration_days: 'duration',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

const TONE: Record<string, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-400',
  blue: 'text-blue-700 dark:text-blue-400',
  red: 'text-red-700 dark:text-red-400',
  amber: 'text-amber-700 dark:text-amber-400',
  neutral: 'text-neutral-500 dark:text-neutral-400',
};

function Stat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className={cn('tabular-nums', n > 0 ? TONE[tone] : TONE.neutral)}>
      {n} <span className="opacity-70">{label}</span>
    </span>
  );
}

function NameList({ tone, label, names }: { tone: string; label: string; names: string[] }) {
  const shown = names.slice(0, 6);
  return (
    <div className={cn('mt-0.5 text-[11px]', TONE[tone])}>
      <span className="opacity-70">{label}: </span>
      {shown.join(', ')}
      {names.length > shown.length && (
        <span className="opacity-70"> +{names.length - shown.length}</span>
      )}
    </div>
  );
}

export type { WorkItem };
