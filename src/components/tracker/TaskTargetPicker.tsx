import { useMemo, useState } from 'react';
import { Briefcase, ChevronDown, ChevronRight, Clock, ListChecks, Plus, Search, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useT } from '@/lib/i18n';
import { readRecents, type RecentTarget } from '@/hooks/useTimeEntries';
import {
  useTrackerCatalog,
  workItemPath,
  type TrackerCatalog,
  type TrackerCatalogProject,
  type TrackerCatalogWorkItem,
} from '@/hooks/useTrackerCatalog';
import type { TrackerTarget } from '@/types/db';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: TrackerTarget | null;
  onPick: (t: TrackerTarget) => void;
}

export function TaskTargetPicker({ open, onOpenChange, value, onPick }: Props) {
  const t = useT();
  const { data: catalog, isLoading } = useTrackerCatalog();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const recents = useMemo<RecentTarget[]>(() => (open ? readRecents() : []), [open]);
  const q = search.trim().toLowerCase();

  const projects = useMemo(() => {
    if (!catalog) return [];
    if (!q) return catalog.projects;
    // Filter projects by client+project text. Tasks shown via flat-result section below.
    return catalog.projects.filter((p) =>
      `${p.client_name ?? ''} ${p.name}`.toLowerCase().includes(q),
    );
  }, [catalog, q]);

  // Flat task search results (only when searching)
  const taskResults = useMemo(() => {
    if (!catalog || !q) return [] as { wi: TrackerCatalogWorkItem; project: TrackerCatalogProject; path: string[] }[];
    const out: { wi: TrackerCatalogWorkItem; project: TrackerCatalogProject; path: string[] }[] = [];
    const projById = new Map(catalog.projects.map((p) => [p.id, p]));
    for (const wi of catalog.workItems) {
      const project = projById.get(wi.project_id);
      if (!project) continue;
      const path = workItemPath(wi.id, catalog.workItems);
      const full = `${project.client_name ?? ''} ${project.name} ${path.join(' ')}`.toLowerCase();
      if (!full.includes(q)) continue;
      out.push({ wi, project, path });
    }
    return out.slice(0, 200);
  }, [catalog, q]);

  // Suggestion to use search text as custom task on a sensible project
  const customSuggestion = useMemo(() => {
    if (!catalog || !q || q.length < 2 || catalog.projects.length === 0) return null;
    const targetProj =
      catalog.projects.find((p) => p.id === value?.project_id) ??
      catalog.projects.find((p) => p.id === recents[0]?.project_id) ??
      catalog.projects[0];
    return { project: targetProj, text: search.trim() };
  }, [catalog, q, search, value?.project_id, recents]);

  function emit(target: TrackerTarget) {
    onPick(target);
    setSearch('');
    onOpenChange(false);
  }

  function pickProject(p: TrackerCatalogProject) {
    emit({ project_id: p.id, work_item_id: null, custom_task_text: null });
  }
  function pickWorkItem(p: TrackerCatalogProject, workItemId: string) {
    emit({ project_id: p.id, work_item_id: workItemId, custom_task_text: null });
  }
  function pickCustom(p: TrackerCatalogProject, text: string) {
    if (!text.trim()) return;
    emit({ project_id: p.id, work_item_id: null, custom_task_text: text.trim() });
  }
  function pickRecent(r: RecentTarget) {
    emit({ project_id: r.project_id, work_item_id: r.work_item_id, custom_task_text: r.custom_task_text });
  }

  function toggleProject(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSearch('');
          setExpanded(new Set());
        }
        onOpenChange(v);
      }}
    >
      <DialogContent title={t('tracker.pickTarget')} className="w-[560px]">
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <Input
              autoFocus
              placeholder={t('tracker.pickerSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-3">
            {isLoading && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('common.loading')}</div>
            )}

            {!isLoading && catalog && catalog.projects.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('tracker.noProjectsHint')}</div>
            )}

            {/* Recents — only when no search */}
            {!q && recents.length > 0 && catalog && (
              <Section icon={<Clock size={12} />} label={t('tracker.recents')}>
                {recents.map((r) => {
                  const proj = catalog.projects.find((p) => p.id === r.project_id);
                  if (!proj) return null;
                  return (
                    <RecentRow key={recentKey(r)} recent={r} project={proj} catalog={catalog} onClick={() => pickRecent(r)} active={isRecentMatch(value, r)} />
                  );
                })}
              </Section>
            )}

            {/* Projects — primary list, click = pick-with-no-task */}
            {projects.length > 0 && (
              <Section icon={<Briefcase size={12} />} label={t('tracker.projects')}>
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    catalog={catalog!}
                    expanded={expanded.has(p.id)}
                    onToggle={() => toggleProject(p.id)}
                    onPickProject={() => pickProject(p)}
                    onPickWorkItem={(wi) => pickWorkItem(p, wi)}
                    onPickCustom={(text) => pickCustom(p, text)}
                    value={value}
                  />
                ))}
              </Section>
            )}

            {/* Flat task results when searching */}
            {q && taskResults.length > 0 && (
              <Section icon={<ListChecks size={12} />} label={t('tracker.taskMatches')}>
                {taskResults.map(({ wi, project, path }) => (
                  <button
                    key={wi.id}
                    type="button"
                    onClick={() => pickWorkItem(project, wi.id)}
                    className="w-full flex items-center gap-1 px-2 py-1.5 rounded text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <PathSegments parts={[project.client_name ?? '—', project.name, ...path]} />
                  </button>
                ))}
              </Section>
            )}

            {customSuggestion && (
              <Section icon={<Sparkles size={12} />} label={t('tracker.useAsCustom')}>
                <button
                  type="button"
                  onClick={() => pickCustom(customSuggestion.project, customSuggestion.text)}
                  className="w-full flex items-center gap-1 px-2 py-1.5 rounded text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <PathSegments
                    parts={[
                      customSuggestion.project.client_name ?? '—',
                      customSuggestion.project.name,
                      `“${customSuggestion.text}”`,
                    ]}
                  />
                </button>
              </Section>
            )}

            {!isLoading && q && projects.length === 0 && taskResults.length === 0 && !customSuggestion && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400 px-2">{t('tracker.noResults')}</div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----- Project row (collapsible) ---------------------------------------------

function ProjectRow({
  project,
  catalog,
  expanded,
  onToggle,
  onPickProject,
  onPickWorkItem,
  onPickCustom,
  value,
}: {
  project: TrackerCatalogProject;
  catalog: TrackerCatalog;
  expanded: boolean;
  onToggle: () => void;
  onPickProject: () => void;
  onPickWorkItem: (workItemId: string) => void;
  onPickCustom: (text: string) => void;
  value: TrackerTarget | null;
}) {
  const t = useT();
  const items = useMemo(
    () => catalog.workItems.filter((w) => w.project_id === project.id),
    [catalog.workItems, project.id],
  );
  const hasTasks = items.length > 0;
  const tree = useMemo(() => buildTaskTree(items), [items]);
  const active = value?.project_id === project.id && !value.work_item_id && !value.custom_task_text;
  const [customText, setCustomText] = useState('');

  return (
    <div className="rounded border border-transparent">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onPickProject}
          className={[
            'flex-1 flex items-center gap-1.5 px-2 py-2 rounded-l text-sm text-left',
            active ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ].join(' ')}
        >
          <PathSegments parts={[project.client_name ?? '—', project.name]} />
          <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0">
            {t('tracker.noTask')}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? t('tracker.collapseTasks') : t('tracker.expandTasks')}
          title={expanded ? t('tracker.collapseTasks') : t('tracker.expandTasks')}
          className={[
            'h-9 w-9 rounded-r flex items-center justify-center',
            'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800',
            hasTasks ? '' : 'opacity-40 cursor-default',
          ].join(' ')}
          disabled={!hasTasks && !expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="ml-6 my-1 border-l border-neutral-200 dark:border-neutral-800 pl-2 space-y-0.5">
          {tree.length > 0 && tree.map((n) => (
            <TaskNode key={n.id} node={n} onPick={onPickWorkItem} value={value} depth={0} />
          ))}
          {tree.length === 0 && (
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 px-2 py-1">
              {t('tracker.noTasksInProject')}
            </div>
          )}
          <form
            className="flex items-center gap-1 px-1 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              onPickCustom(customText);
              setCustomText('');
            }}
          >
            <Input
              placeholder={t('tracker.customTaskPlaceholder')}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" disabled={!customText.trim()}>
              <Plus size={12} /> {t('common.add')}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

// ----- Task tree -------------------------------------------------------------

interface TaskTreeNode {
  id: string;
  name: string;
  children: TaskTreeNode[];
}

function buildTaskTree(items: TrackerCatalogWorkItem[]): TaskTreeNode[] {
  const byParent = new Map<string | null, TrackerCatalogWorkItem[]>();
  for (const it of items) {
    const k = it.parent_id ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(it);
    else byParent.set(k, [it]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.position - b.position);

  function walk(parent: string | null): TaskTreeNode[] {
    return (byParent.get(parent) ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      children: walk(it.id),
    }));
  }
  return walk(null);
}

function TaskNode({
  node,
  onPick,
  value,
  depth,
}: {
  node: TaskTreeNode;
  onPick: (workItemId: string) => void;
  value: TrackerTarget | null;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const active = value?.work_item_id === node.id;

  return (
    <div>
      <div className="flex items-center">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="h-6 w-6 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <button
          type="button"
          onClick={() => onPick(node.id)}
          className={[
            'flex-1 px-2 py-1 rounded text-sm text-left truncate',
            active
              ? 'bg-neutral-200 dark:bg-neutral-800 font-medium'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ].join(' ')}
        >
          {node.name}
        </button>
      </div>
      {hasChildren && open && (
        <div className="ml-4 border-l border-neutral-200 dark:border-neutral-800 pl-2">
          {node.children.map((c) => (
            <TaskNode key={c.id} node={c} onPick={onPick} value={value} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Recents row -----------------------------------------------------------

function RecentRow({
  recent,
  project,
  catalog,
  onClick,
  active,
}: {
  recent: RecentTarget;
  project: TrackerCatalogProject;
  catalog: TrackerCatalog;
  onClick: () => void;
  active: boolean;
}) {
  const t = useT();
  const parts: string[] = [project.client_name ?? '—', project.name];
  if (recent.work_item_id) {
    parts.push(...workItemPath(recent.work_item_id, catalog.workItems));
  } else if (recent.custom_task_text) {
    parts.push(`“${recent.custom_task_text}”`);
  } else {
    parts.push(t('tracker.noTask'));
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full flex items-center gap-1 px-2 py-1.5 rounded text-sm text-left',
        active ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
      ].join(' ')}
    >
      <PathSegments parts={parts} />
    </button>
  );
}

function recentKey(r: RecentTarget): string {
  return `r|${r.project_id}|${r.work_item_id ?? ''}|${r.custom_task_text ?? ''}`;
}

function isRecentMatch(value: TrackerTarget | null, r: RecentTarget): boolean {
  if (!value) return false;
  return (
    value.project_id === r.project_id &&
    (value.work_item_id ?? null) === r.work_item_id &&
    (value.custom_task_text ?? null) === r.custom_task_text
  );
}

// ----- Shared --------------------------------------------------------------

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 px-2 pb-1">
        {icon}<span>{label}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function PathSegments({ parts }: { parts: string[] }) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span
            className={[
              'truncate',
              i === parts.length - 1 ? 'text-neutral-900 dark:text-neutral-100 font-medium' : 'text-neutral-500 dark:text-neutral-400',
            ].join(' ')}
          >
            {p}
          </span>
          {i < parts.length - 1 && <ChevronRight size={10} className="text-neutral-300 dark:text-neutral-600 shrink-0" />}
        </span>
      ))}
    </span>
  );
}

// ----- Trigger (used by LiveTimer / ManualEntry / SessionEdit) ---------------

interface TriggerProps {
  value: TrackerTarget | null;
  catalog: TrackerCatalog | undefined;
  onClick: () => void;
  onClear?: () => void;
  placeholder?: string;
}

export function TaskTargetTrigger({ value, catalog, onClick, onClear, placeholder }: TriggerProps) {
  const t = useT();
  const label = useMemo(() => {
    if (!value || !catalog) return null;
    return labelForTarget(value, catalog);
  }, [value, catalog]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        className="flex-1 flex items-center gap-2 px-3 h-9 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
      >
        {label ? (
          <PathSegments parts={label} />
        ) : (
          <span className="text-neutral-400 dark:text-neutral-500">{placeholder ?? t('tracker.pickTarget')}</span>
        )}
      </button>
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('tracker.clearTarget')}
          title={t('tracker.clearTarget')}
          className="h-9 w-9 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function labelForTarget(value: TrackerTarget, catalog: TrackerCatalog): string[] {
  const project = catalog.projects.find((p) => p.id === value.project_id);
  if (!project) return ['—'];
  const out: string[] = [project.client_name ?? '—', project.name];
  if (value.work_item_id) {
    out.push(...workItemPath(value.work_item_id, catalog.workItems));
  } else if (value.custom_task_text) {
    out.push(`“${value.custom_task_text}”`);
  } else {
    out.push('No task');
  }
  return out;
}
