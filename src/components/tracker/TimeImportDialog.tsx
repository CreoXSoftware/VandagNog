import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileUp,
  HelpCircle,
  Undo2,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';
import { hashKey, parseClockify, type DateOrder, type ImportRow, type RowProblem } from '@/lib/import/clockify';
import { normName } from '@/lib/import/match';
import {
  buildGroups,
  canEdit,
  computePlan,
  initialDecisions,
  type ClientDecision,
  type Decisions,
  type Directory,
  type Groups,
  type MatchReason,
  type Plan,
  type PlannedRow,
  type ProjectDecision,
  type ProjectGroup,
  type RowStatus,
} from '@/lib/import/plan';
import {
  ImportSetupMissingError,
  useImportDirectory,
  useImportExistingState,
  useRunTimeImport,
  type ImportProgress,
  type ImportResult,
} from '@/hooks/useTimeImport';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = 'review' | 'running' | 'done';

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)} h`;

// Imports a Clockify CSV into the tracker. Everything uncertain is surfaced
// for a decision before anything is written: projects, clients and people are
// matched by name/email, near-misses are only suggested, and every row that
// will not be imported says why.
export function TimeImportDialog({ open, onOpenChange }: Props) {
  const t = useT();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [orderOverride, setOrderOverride] = useState<DateOrder | undefined>();
  const [phase, setPhase] = useState<Phase>('review');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const dir = useImportDirectory(open);
  const parsed = useMemo(
    () => (file ? parseClockify(file.text, orderOverride) : null),
    [file, orderOverride],
  );
  const signature = useMemo(
    () => (parsed && parsed.rows.length ? hashKey(parsed.rows.map((r) => r.key).join(',')) : null),
    [parsed],
  );
  const existing = useImportExistingState(parsed?.rows ?? null, signature);
  const setupMissing = existing.error instanceof ImportSetupMissingError;

  const groups = useMemo(
    () => (parsed && dir.data ? buildGroups(parsed, dir.data) : null),
    [parsed, dir.data],
  );

  // Decisions reset whenever a different file (or date order) is loaded.
  // Adjusted during render rather than in an effect, so no frame renders a
  // plan for the new file with the old file's decisions.
  const groupsSig = groups && signature ? signature : null;
  const [dec, setDec] = useState<{ sig: string | null; d: Decisions | null }>({ sig: null, d: null });
  if (groups && dir.data && dec.sig !== groupsSig) {
    setDec({ sig: groupsSig, d: initialDecisions(groups) });
  }
  const decisions = dec.sig === groupsSig ? dec.d : null;
  const update = (fn: (d: Decisions) => Decisions) =>
    setDec((prev) => (prev.d ? { ...prev, d: fn(prev.d) } : prev));

  const plan = useMemo(
    () =>
      parsed && dir.data && groups && decisions
        ? computePlan(parsed, dir.data, groups, decisions, existing.data ?? null)
        : null,
    [parsed, dir.data, groups, decisions, existing.data],
  );

  const { run, undo } = useRunTimeImport();

  function reset() {
    setFile(null);
    setOrderOverride(undefined);
    setPhase('review');
    setProgress(null);
    setResult(null);
    setRunError(null);
  }

  async function onImport() {
    if (!plan || !decisions || !dir.data) return;
    setPhase('running');
    setRunError(null);
    try {
      const res = await run(plan, decisions, dir.data, setProgress);
      setResult(res);
      setPhase('done');
    } catch (e) {
      setRunError(
        e instanceof ImportSetupMissingError ? t('tracker.import.setupMissing') : (e as Error).message,
      );
      setPhase('review');
    }
  }

  async function onUndo() {
    if (!result) return;
    if (!confirm(t('tracker.import.undoConfirm', { n: result.inserted }))) return;
    try {
      const n = await undo(result.batchId);
      toast.success(t('tracker.import.undone', { n }));
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const undecidedCount = plan
    ? plan.undecided.projects.length + plan.undecided.people.length + plan.undecided.clients.length
    : 0;
  const canImport =
    phase === 'review' &&
    !!plan &&
    undecidedCount === 0 &&
    plan.counts.ready > 0 &&
    !setupMissing &&
    !existing.isLoading &&
    !existing.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (phase === 'running') return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={t('tracker.import.title')}
        className="w-[1100px] max-h-[92vh] flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto -mx-5 px-5 space-y-4">
          {phase === 'done' && result ? (
            <ResultView result={result} />
          ) : phase === 'running' ? (
            <ProgressView progress={progress} />
          ) : !file || !parsed ? (
            <FilePicker onFile={setFile} />
          ) : parsed.missingColumns.length > 0 ? (
            <Banner tone="error">
              {t('tracker.import.missingColumns', { cols: parsed.missingColumns.join(', ') })}
              <button className="ml-2 underline" onClick={reset}>
                {t('tracker.import.chooseOther')}
              </button>
            </Banner>
          ) : dir.error ? (
            <Banner tone="error">{(dir.error as Error).message}</Banner>
          ) : !groups || !decisions || !plan ? (
            <div className="py-10 text-center text-sm text-neutral-500">{t('common.loading')}</div>
          ) : (
            <Review
              fileName={file.name}
              rows={parsed.rows}
              dateOrder={parsed.dateOrder}
              dateOrderCertain={parsed.dateOrderCertain}
              onDateOrder={setOrderOverride}
              onChooseOther={reset}
              dir={dir.data!}
              groups={groups}
              decisions={decisions}
              update={update}
              plan={plan}
              setupMissing={setupMissing}
              checking={existing.isLoading}
              checkError={existing.error && !setupMissing ? (existing.error as Error).message : null}
              runError={runError}
              undecidedCount={undecidedCount}
            />
          )}
        </div>

        <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 mt-3 flex items-center gap-3">
          {phase === 'done' ? (
            <>
              {result && result.inserted > 0 && (
                <Button variant="outline" size="sm" onClick={onUndo}>
                  <Undo2 size={13} />
                  {t('tracker.import.undo')}
                </Button>
              )}
              <div className="flex-1" />
              <Button size="sm" onClick={() => { reset(); onOpenChange(false); }}>
                {t('tracker.import.close')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1 text-xs text-neutral-600 dark:text-neutral-300">
                {plan && phase === 'review' && <PlanSummary plan={plan} />}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={phase === 'running'}
                onClick={() => { reset(); onOpenChange(false); }}
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" disabled={!canImport} onClick={onImport}>
                {phase === 'running'
                  ? t('tracker.import.importing')
                  : t('tracker.import.importN', { n: plan?.counts.ready ?? 0 })}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- File picking ---------------------------------------------------------------

function FilePicker({ onFile }: { onFile: (f: { name: string; text: string }) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  async function read(f: File | undefined) {
    if (!f) return;
    onFile({ name: f.name, text: await f.text() });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('tracker.import.intro')}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files[0]);
        }}
        className={cn(
          'w-full rounded-lg border-2 border-dashed px-6 py-12 flex flex-col items-center gap-2 text-sm',
          over
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
            : 'border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
        )}
      >
        <FileUp size={24} className="text-neutral-400" />
        <span className="font-medium">{t('tracker.import.drop')}</span>
        <span className="text-xs text-neutral-500">{t('tracker.import.dropHint')}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => void read(e.target.files?.[0])}
      />
      <ul className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1 list-disc pl-5">
        <li>{t('tracker.import.howDedup')}</li>
        <li>{t('tracker.import.howMapping')}</li>
        <li>{t('tracker.import.howTasks')}</li>
      </ul>
    </div>
  );
}

// ---- Review -------------------------------------------------------------------------

interface ReviewProps {
  fileName: string;
  rows: ImportRow[];
  dateOrder: DateOrder;
  dateOrderCertain: boolean;
  onDateOrder: (o: DateOrder) => void;
  onChooseOther: () => void;
  dir: Directory;
  groups: Groups;
  decisions: Decisions;
  update: (fn: (d: Decisions) => Decisions) => void;
  plan: Plan;
  setupMissing: boolean;
  checking: boolean;
  checkError: string | null;
  runError: string | null;
  undecidedCount: number;
}

function Review(p: ReviewProps) {
  const t = useT();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = p.rows.map((r) => r.startLocal?.slice(0, 10)).filter(Boolean).sort() as string[];
  const clientGroups = p.groups.clients.filter((c) => p.plan.clientsInUse.has(c.key));

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{p.fileName}</span>
        <span>{t('tracker.import.rowsN', { n: p.rows.length })}</span>
        {days.length > 0 && (
          <span>
            {days[0]} → {days[days.length - 1]}
          </span>
        )}
        <span title={t('tracker.import.tzHint')}>{t('tracker.import.tz', { tz })}</span>
        <span className="flex items-center gap-1">
          {t('tracker.import.dateOrder')}
          <select
            value={p.dateOrder}
            onChange={(e) => p.onDateOrder(e.target.value as DateOrder)}
            className="h-6 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs px-1"
          >
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
          {!p.dateOrderCertain && (
            <span className="text-amber-600 dark:text-amber-400">{t('tracker.import.dateOrderGuess')}</span>
          )}
        </span>
        <button className="ml-auto underline" onClick={p.onChooseOther}>
          {t('tracker.import.chooseOther')}
        </button>
      </div>

      {p.setupMissing && <Banner tone="error">{t('tracker.import.setupMissing')}</Banner>}
      {p.checkError && <Banner tone="error">{p.checkError}</Banner>}
      {p.runError && <Banner tone="error">{p.runError}</Banner>}
      {p.checking && <Banner tone="info">{t('tracker.import.checking')}</Banner>}
      {p.undecidedCount > 0 && (
        <Banner tone="warn">{t('tracker.import.needsDecisions', { n: p.undecidedCount })}</Banner>
      )}

      <StatusChips plan={p.plan} />

      <Section title={t('tracker.import.projects')} count={p.groups.projects.length} defaultOpen>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{t('tracker.import.projectsHint')}</p>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {p.groups.projects.map((g) => (
            <ProjectRow key={g.key} g={g} dir={p.dir} decisions={p.decisions} update={p.update} plan={p.plan} />
          ))}
        </div>
      </Section>

      {clientGroups.length > 0 && (
        <Section title={t('tracker.import.clients')} count={clientGroups.length} defaultOpen>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{t('tracker.import.clientsHint')}</p>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {clientGroups.map((c) => (
              <ClientRow key={c.key} name={c.name} groupKey={c.key} reason={c.reason}
                exact={c.exact.map((x) => x.item)} similar={c.similar.map((x) => x.item)}
                dir={p.dir} decision={p.decisions.clients[c.key] ?? null}
                onChange={(v) => p.update((d) => ({ ...d, clients: { ...d.clients, [c.key]: v } }))} />
            ))}
          </div>
        </Section>
      )}

      <Section title={t('tracker.import.people')} count={p.groups.people.length} defaultOpen>
        <label className="flex items-start gap-2 text-xs mb-2 text-neutral-700 dark:text-neutral-200">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={p.decisions.addMembers}
            onChange={(e) => p.update((d) => ({ ...d, addMembers: e.target.checked }))}
          />
          <span>
            {t('tracker.import.addMembers')}
            <span className="block text-neutral-500 dark:text-neutral-400">{t('tracker.import.addMembersHint')}</span>
          </span>
        </label>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {p.groups.people.map((g) => {
            const dv = p.decisions.people[g.key] ?? null;
            const value = !dv ? '' : dv.kind === 'skip' ? 'skip' : `e:${dv.userId}`;
            const suggested = new Set(g.similar.map((s) => s.item.userId));
            return (
              <div key={g.key} className="flex items-center gap-3 py-2 text-sm">
                <ReasonBadge reason={g.match ? 'exact' : g.similar.length ? 'similar' : 'new'} person />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{g.name}</div>
                  <div className="text-[11px] text-neutral-500 truncate">
                    {g.email || '—'} · {t('tracker.import.rowsN', { n: g.rows.length })}
                  </div>
                </div>
                <select
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    p.update((d) => ({
                      ...d,
                      people: {
                        ...d.people,
                        [g.key]: !v ? null : v === 'skip' ? { kind: 'skip' } : { kind: 'existing', userId: v.slice(2) },
                      },
                    }));
                  }}
                  className={selectCls(!dv)}
                >
                  <option value="">{t('tracker.import.choose')}</option>
                  {g.similar.length > 0 && (
                    <optgroup label={t('tracker.import.suggested')}>
                      {g.similar.map((s) => (
                        <option key={s.item.userId} value={`e:${s.item.userId}`}>
                          {s.item.name}{s.item.email ? ` (${s.item.email})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={t('tracker.import.everyone')}>
                    {p.dir.people
                      .filter((x) => !suggested.has(x.userId))
                      .map((x) => (
                        <option key={x.userId} value={`e:${x.userId}`}>
                          {x.name}{x.email ? ` (${x.email})` : ''}
                        </option>
                      ))}
                  </optgroup>
                  <option value="skip">{t('tracker.import.skipPersonRows')}</option>
                </select>
              </div>
            );
          })}
        </div>
      </Section>

      <RowsToCheck plan={p.plan} dir={p.dir} update={p.update} />
    </>
  );
}

function ProjectRow({
  g,
  dir,
  decisions,
  update,
  plan,
}: {
  g: ProjectGroup;
  dir: Directory;
  decisions: Decisions;
  update: ReviewProps['update'];
  plan: Plan;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dv = decisions.projects[g.key] ?? null;
  const value = !dv ? '' : dv.kind === 'existing' ? `e:${dv.projectId}` : dv.kind;
  const target = dv?.kind === 'existing' ? dir.projects.find((x) => x.id === dv.projectId) : undefined;
  const suggestions = [...g.exact, ...g.similar].map((c) => c.item);
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const editable = dir.projects.filter((x) => canEdit(x) && !suggestedIds.has(x.id));

  const set = (d: ProjectDecision) =>
    update((prev) => ({ ...prev, projects: { ...prev.projects, [g.key]: d } }));

  // Task names and where each one ends up.
  const wiIndex = useMemo(() => {
    const m = new Map<string, string>();
    if (target) for (const w of dir.workItems) if (w.projectId === target.id) m.set(normName(w.name), w.name);
    return m;
  }, [target, dir.workItems]);
  const unmatched = [...g.tasks.keys()].filter((k) => !wiIndex.has(normName(k)));
  const mode = decisions.taskMode[g.key] ?? 'workItem';

  const clientMismatch =
    target && g.client && normName(target.clientName ?? '') !== normName(g.client);
  const ready = g.rows.filter((i) => plan.rows[i].status === 'ready').length;

  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 text-neutral-400 hover:text-neutral-700"
          aria-label={t('tracker.import.showTasks')}
          disabled={g.tasks.size === 0}
        >
          {g.tasks.size > 0 ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="inline-block w-3.5" />}
        </button>
        <ReasonBadge reason={g.reason} />
        <div className="flex-1 min-w-0">
          <div className="truncate">{g.project || t('tracker.import.noProject')}</div>
          <div className="text-[11px] text-neutral-500 truncate">
            {g.client ? `${g.client} · ` : ''}
            {t('tracker.import.rowsN', { n: g.rows.length })} · {hours(g.minutes)}
            {ready !== g.rows.length && ` · ${t('tracker.import.readyN', { n: ready })}`}
          </div>
        </div>
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) set(null);
            else if (v === 'skip') set({ kind: 'skip' });
            else if (v === 'create') set({ kind: 'create', name: g.project.trim() });
            else set({ kind: 'existing', projectId: v.slice(2) });
          }}
          className={cn(selectCls(!dv), 'w-64')}
        >
          <option value="">{t('tracker.import.choose')}</option>
          {suggestions.length > 0 && (
            <optgroup label={t('tracker.import.suggested')}>
              {suggestions.map((s) => (
                <option key={s.id} value={`e:${s.id}`} disabled={!canEdit(s)}>
                  {s.name}
                  {s.clientName ? ` — ${s.clientName}` : ''}
                  {!canEdit(s) ? ` (${t('tracker.import.viewOnly')})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('tracker.import.allProjects')}>
            {editable.map((s) => (
              <option key={s.id} value={`e:${s.id}`}>
                {s.name}
                {s.clientName ? ` — ${s.clientName}` : ''}
              </option>
            ))}
          </optgroup>
          <option value="create">{t('tracker.import.createProject')}</option>
          <option value="skip">{t('tracker.import.skipRows')}</option>
        </select>
        {dv?.kind === 'create' && (
          <input
            value={dv.name}
            onChange={(e) => set({ kind: 'create', name: e.target.value })}
            className={cn(inputCls, 'w-48', !dv.name.trim() && 'border-red-400')}
            aria-label={t('tracker.import.newProjectName')}
            placeholder={t('tracker.import.newProjectName')}
          />
        )}
        {unmatched.length > 0 && dv && dv.kind !== 'skip' && (
          <select
            value={mode}
            onChange={(e) =>
              update((prev) => ({
                ...prev,
                taskMode: { ...prev.taskMode, [g.key]: e.target.value as 'workItem' | 'custom' },
              }))
            }
            className={cn(selectCls(false), 'w-44')}
            title={t('tracker.import.taskModeHint')}
          >
            <option value="workItem">{t('tracker.import.taskModeCreate', { n: unmatched.length })}</option>
            <option value="custom">{t('tracker.import.taskModeText', { n: unmatched.length })}</option>
          </select>
        )}
      </div>
      {(clientMismatch || g.reason === 'view_only' || g.reason === 'ambiguous' || g.reason === 'similar') && (
        <div className="ml-[3.25rem] mt-1 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
          {g.reason === 'ambiguous' && <div>{t('tracker.import.ambiguousHint')}</div>}
          {g.reason === 'similar' && <div>{t('tracker.import.similarHint')}</div>}
          {g.reason === 'view_only' && <div>{t('tracker.import.viewOnlyHint')}</div>}
          {clientMismatch && (
            <div>
              {t('tracker.import.clientMismatch', {
                file: g.client,
                ours: target?.clientName || t('tracker.import.noClient'),
              })}
            </div>
          )}
        </div>
      )}
      {open && g.tasks.size > 0 && (
        <ul className="ml-[3.25rem] mt-1.5 text-xs space-y-0.5">
          {[...g.tasks.entries()].map(([task, n]) => {
            const match = wiIndex.get(normName(task));
            return (
              <li key={task} className="flex items-center gap-2">
                <span className="truncate">{task}</span>
                <span className="text-neutral-400">×{n}</span>
                <span className="text-neutral-500">→</span>
                {match ? (
                  <span className="text-emerald-700 dark:text-emerald-400">{t('tracker.import.taskMatched', { name: match })}</span>
                ) : dv?.kind === 'skip' || !dv ? (
                  <span className="text-neutral-400">—</span>
                ) : mode === 'workItem' ? (
                  <span className="text-blue-700 dark:text-blue-400">{t('tracker.import.taskWillCreate')}</span>
                ) : (
                  <span className="text-neutral-500">{t('tracker.import.taskAsText')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ClientRow({
  name,
  groupKey,
  reason,
  exact,
  similar,
  dir,
  decision,
  onChange,
}: {
  name: string;
  groupKey: string;
  reason: MatchReason;
  exact: Directory['clients'];
  similar: Directory['clients'];
  dir: Directory;
  decision: ClientDecision;
  onChange: (d: ClientDecision) => void;
}) {
  const t = useT();
  const value = !decision ? '' : decision.kind === 'existing' ? `e:${decision.clientId}` : decision.kind;
  const suggestions = [...exact, ...similar];
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const label = (c: Directory['clients'][number]) => c.name;

  return (
    <div className="py-2" data-client={groupKey}>
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-block w-3.5" />
        <ReasonBadge reason={reason} />
        <div className="flex-1 min-w-0 truncate">{name}</div>
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onChange(null);
            else if (v === 'none') onChange({ kind: 'none' });
            else if (v === 'create') onChange({ kind: 'create', name: name.trim() });
            else onChange({ kind: 'existing', clientId: v.slice(2) });
          }}
          className={cn(selectCls(!decision), 'w-64')}
        >
          <option value="">{t('tracker.import.choose')}</option>
          {suggestions.length > 0 && (
            <optgroup label={t('tracker.import.suggested')}>
              {suggestions.map((c) => (
                <option key={c.id} value={`e:${c.id}`}>{label(c)}</option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('tracker.import.allClients')}>
            {dir.clients.filter((c) => !suggestedIds.has(c.id)).map((c) => (
              <option key={c.id} value={`e:${c.id}`}>{label(c)}</option>
            ))}
          </optgroup>
          <option value="create">{t('tracker.import.createClient')}</option>
          <option value="none">{t('tracker.import.noClient')}</option>
        </select>
        {decision?.kind === 'create' && (
          <input
            value={decision.name}
            onChange={(e) => onChange({ ...decision, name: e.target.value })}
            className={cn(inputCls, 'w-44', !decision.name.trim() && 'border-red-400')}
            aria-label={t('tracker.import.newClientName')}
          />
        )}
      </div>
      {reason === 'similar' && (
        <div className="ml-[3.25rem] mt-1 text-[11px] text-amber-700 dark:text-amber-400">
          {t('tracker.import.similarClientHint')}
        </div>
      )}
    </div>
  );
}

// ---- Flagged rows ----------------------------------------------------------------

const REVIEW_STATUSES: RowStatus[] = ['possible_duplicate', 'not_member', 'blocked', 'excluded'];

function RowsToCheck({ plan, dir, update }: { plan: Plan; dir: Directory; update: ReviewProps['update'] }) {
  const t = useT();
  const people = useMemo(() => new Map(dir.people.map((p) => [p.userId, p.name])), [dir.people]);
  const byStatus = (s: RowStatus) => plan.rows.filter((r) => r.status === s);
  const dups = plan.rows.filter((r) => r.duplicate && (r.status === 'possible_duplicate' || r.status === 'ready'));
  const warned = plan.rows.filter(
    (r) => (r.status === 'ready' && !r.duplicate && r.warnings.length > 0) || (r.status === 'excluded' && !r.duplicate),
  );
  const total =
    dups.length + warned.length + REVIEW_STATUSES.reduce((n, s) => n + (s === 'possible_duplicate' || s === 'excluded' ? 0 : byStatus(s).length), 0);
  if (total === 0 && plan.counts.already === 0) return null;

  const setInclude = (rows: PlannedRow[], v: boolean | undefined) =>
    update((d) => {
      const next = { ...d.rowInclude };
      for (const r of rows) {
        if (v === undefined) delete next[r.row.index];
        else next[r.row.index] = v;
      }
      return { ...d, rowInclude: next };
    });

  const fmt = (r: PlannedRow) => {
    const who = r.userId ? (people.get(r.userId) ?? r.row.userName) : r.row.userName;
    return (
      <>
        <span className="tabular-nums text-neutral-500 w-32 shrink-0">{r.row.startLocal ?? '—'}</span>
        <span className="w-28 shrink-0 truncate">{who}</span>
        <span className="w-40 shrink-0 truncate">{r.row.project}</span>
        <span className="flex-1 min-w-0 truncate text-neutral-500">
          {[r.row.task, r.row.description].filter(Boolean).join(' · ') || '—'}
        </span>
        <span className="tabular-nums shrink-0">{r.row.minutes != null ? hours(r.row.minutes) : '—'}</span>
        <span className="text-[10px] text-neutral-400 shrink-0 w-14 text-right">
          {t('tracker.import.line', { n: r.row.line })}
        </span>
      </>
    );
  };

  return (
    <Section title={t('tracker.import.rowsToCheck')} count={total}>
      {plan.counts.already > 0 && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-emerald-600" />
          {t('tracker.import.alreadyN', { n: plan.counts.already })}
        </p>
      )}

      <RowGroup
        title={t('tracker.import.dupTitle')}
        hint={t('tracker.import.dupHint')}
        rows={dups}
        action={(rows) => (
          <button className="underline" onClick={() => setInclude(rows, true)}>
            {t('tracker.import.includeAll')}
          </button>
        )}
        render={(r) => (
          <>
            <input
              type="checkbox"
              checked={r.status === 'ready'}
              onChange={(e) => setInclude([r], e.target.checked ? true : undefined)}
              aria-label={t('tracker.import.include')}
            />
            {fmt(r)}
          </>
        )}
      />

      <RowGroup
        title={t('tracker.import.warnTitle')}
        hint={t('tracker.import.warnHint')}
        rows={warned}
        render={(r) => (
          <>
            <input
              type="checkbox"
              checked={r.status === 'ready'}
              onChange={(e) => setInclude([r], e.target.checked ? undefined : false)}
              aria-label={t('tracker.import.include')}
            />
            {fmt(r)}
            <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
              {r.warnings.map((w) => problemLabel(t, w)).join(', ')}
            </span>
          </>
        )}
      />

      <RowGroup
        title={t('tracker.import.notMemberTitle')}
        hint={t('tracker.import.notMemberHint')}
        rows={byStatus('not_member')}
        render={(r) => (
          <>
            <span className="w-3.5 shrink-0" />
            {fmt(r)}
          </>
        )}
      />

      <RowGroup
        title={t('tracker.import.blockedTitle')}
        hint={t('tracker.import.blockedHint')}
        rows={byStatus('blocked')}
        render={(r) => (
          <>
            <span className="w-3.5 shrink-0" />
            {fmt(r)}
            <span className="shrink-0 text-[10px] text-red-600 dark:text-red-400">
              {r.row.problems.map((w) => problemLabel(t, w)).join(', ')}
            </span>
          </>
        )}
      />
    </Section>
  );
}

function RowGroup({
  title,
  hint,
  rows,
  render,
  action,
}: {
  title: string;
  hint: string;
  rows: PlannedRow[];
  render: (r: PlannedRow) => React.ReactNode;
  action?: (rows: PlannedRow[]) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-medium">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title} ({rows.length})
        </button>
        {action && <span className="ml-auto">{action(rows)}</span>}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 ml-5">{hint}</p>
      {open && (
        <ul className="mt-1 ml-5 space-y-0.5">
          {rows.map((r) => (
            <li key={r.row.index} className="flex items-center gap-2 text-xs">
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function problemLabel(t: ReturnType<typeof useT>, p: RowProblem): string {
  const keys: Record<RowProblem, TKey> = {
    unparsable: 'tracker.import.problem.unparsable',
    zero_duration: 'tracker.import.problem.zero',
    long: 'tracker.import.problem.long',
    duration_mismatch: 'tracker.import.problem.mismatch',
  };
  return t(keys[p]);
}

// ---- Summary, progress, result -----------------------------------------------------

function StatusChips({ plan }: { plan: Plan }) {
  const t = useT();
  const chip = (label: string, n: number, cls: string) =>
    n > 0 && (
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] tabular-nums', cls)}>
        {label}: {n}
      </span>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {chip(t('tracker.import.status.ready'), plan.counts.ready, 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300')}
      {chip(t('tracker.import.status.already'), plan.counts.already, 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300')}
      {chip(t('tracker.import.status.undecided'), plan.counts.undecided, 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}
      {chip(t('tracker.import.status.possible_duplicate'), plan.counts.possible_duplicate, 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}
      {chip(t('tracker.import.status.not_member'), plan.counts.not_member, 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}
      {chip(t('tracker.import.status.skipped'), plan.counts.skipped, 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300')}
      {chip(t('tracker.import.status.excluded'), plan.counts.excluded, 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300')}
      {chip(t('tracker.import.status.blocked'), plan.counts.blocked, 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300')}
    </div>
  );
}

function PlanSummary({ plan }: { plan: Plan }) {
  const t = useT();
  const wi = [...plan.newWorkItems.values()].reduce((n, a) => n + a.length, 0);
  const parts = [
    t('tracker.import.sumEntries', { n: plan.counts.ready, h: hours(plan.readyMinutes) }),
    plan.newProjects.length > 0 && t('tracker.import.sumProjects', { n: plan.newProjects.length }),
    plan.newClients.length > 0 && t('tracker.import.sumClients', { n: plan.newClients.length }),
    wi > 0 && t('tracker.import.sumTasks', { n: wi }),
    plan.membersToAdd > 0 && t('tracker.import.sumMembers', { n: plan.membersToAdd }),
  ].filter(Boolean);
  return <span>{parts.join(' · ')}</span>;
}

function ProgressView({ progress }: { progress: ImportProgress | null }) {
  const t = useT();
  const labels: Record<ImportProgress['step'], TKey> = {
    clients: 'tracker.import.step.clients',
    projects: 'tracker.import.step.projects',
    workItems: 'tracker.import.step.workItems',
    entries: 'tracker.import.step.entries',
    done: 'tracker.import.step.done',
  };
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="py-10 max-w-md mx-auto space-y-3 text-center">
      <div className="text-sm">{progress ? t(labels[progress.step]) : t('tracker.import.importing')}</div>
      <div className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {progress && progress.total > 0 && (
        <div className="text-xs text-neutral-500 tabular-nums">
          {progress.done} / {progress.total}
        </div>
      )}
    </div>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  const t = useT();
  const reasonKey: Record<string, TKey> = {
    missing_fields: 'tracker.import.err.missing_fields',
    invalid_range: 'tracker.import.err.invalid_range',
    not_editor: 'tracker.import.err.not_editor',
    not_member: 'tracker.import.err.not_member',
    bad_work_item: 'tracker.import.err.bad_work_item',
    error: 'tracker.import.err.error',
  };
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 size={18} className="text-emerald-600" />
        {t('tracker.import.doneTitle', { n: result.inserted })}
      </div>
      <ul className="text-sm space-y-1 text-neutral-700 dark:text-neutral-200">
        {result.duplicates > 0 && <li>{t('tracker.import.doneDuplicates', { n: result.duplicates })}</li>}
        {result.createdProjects > 0 && <li>{t('tracker.import.doneProjects', { n: result.createdProjects })}</li>}
        {result.createdClients > 0 && <li>{t('tracker.import.doneClients', { n: result.createdClients })}</li>}
        {result.createdWorkItems > 0 && <li>{t('tracker.import.doneTasks', { n: result.createdWorkItems })}</li>}
        {result.membersAdded > 0 && <li>{t('tracker.import.doneMembers', { n: result.membersAdded })}</li>}
      </ul>
      {result.errors.length > 0 && (
        <Banner tone="error">
          <div className="font-medium mb-1">{t('tracker.import.doneErrors', { n: result.errors.length })}</div>
          <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
            {result.errors.map((e, i) => (
              <li key={i}>
                {e.line ? `${t('tracker.import.line', { n: e.line })}: ` : ''}
                {t(reasonKey[e.reason] ?? 'tracker.import.err.error')}
                {e.detail ? ` — ${e.detail}` : ''}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.import.undoHint')}</p>
    </div>
  );
}

// ---- Small pieces --------------------------------------------------------------------

const inputCls =
  'h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm';

function selectCls(undecided: boolean) {
  return cn(
    'h-8 rounded-md border bg-white dark:bg-neutral-900 px-1.5 text-sm',
    undecided
      ? 'border-amber-400 ring-1 ring-amber-300 dark:border-amber-500 dark:ring-amber-700'
      : 'border-neutral-300 dark:border-neutral-700',
  );
}

function ReasonBadge({ reason, person }: { reason: MatchReason; person?: boolean }) {
  const t = useT();
  const map: Record<MatchReason, { key: TKey; cls: string }> = {
    exact: {
      key: person ? 'tracker.import.reason.email' : 'tracker.import.reason.exact',
      cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    ambiguous: { key: 'tracker.import.reason.ambiguous', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    similar: { key: 'tracker.import.reason.similar', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    new: {
      key: person ? 'tracker.import.reason.unknown' : 'tracker.import.reason.new',
      cls: person
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    },
    view_only: { key: 'tracker.import.reason.viewOnly', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  };
  const m = map[reason];
  return (
    <span className={cn('shrink-0 w-20 text-center rounded px-1.5 py-0.5 text-[10px] font-medium', m.cls)}>
      {t(m.key)}
    </span>
  );
}

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 h-9 text-sm font-medium bg-neutral-50 dark:bg-neutral-900/60 rounded-t-lg"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
        <span className="text-xs font-normal text-neutral-500">({count})</span>
      </button>
      {open && <div className="px-3 py-2">{children}</div>}
    </section>
  );
}

function Banner({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: React.ReactNode }) {
  const cls = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    info: 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
  }[tone];
  const Icon = tone === 'info' ? HelpCircle : AlertTriangle;
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm flex gap-2', cls)}>
      <Icon size={15} className="shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

