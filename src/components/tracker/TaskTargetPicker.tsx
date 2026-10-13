import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  EyeOff,
  ListChecks,
  Pin,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import { useT } from '@/lib/i18n';
import { readRecents, type RecentTarget } from '@/hooks/useTimeEntries';
import { useProjectPrefs } from '@/hooks/useProjects';
import {
  useOrgTrackerCatalog,
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

// Same ordering as the Projects page: case-insensitive, numeric-aware names.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const byName = (a: TrackerCatalogProject, b: TrackerCatalogProject) =>
  nameCollator.compare(a.name, b.name);

const NO_CLIENT_KEY = '__none__';
const OPEN_CLIENTS_KEY = 'vn.tracker.picker.openClients';

interface ClientGroup {
  key: string;
  name: string | null;
  projects: TrackerCatalogProject[];
}

export function TaskTargetPicker({ open, onOpenChange, value, onPick }: Props) {
  const t = useT();
  // Only the current organization's projects are offered.
  const { data: catalog, isLoading } = useOrgTrackerCatalog();
  const { data: prefs = [] } = useProjectPrefs();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openClients, setOpenClients] = useState<Set<string>>(readOpenClients);
  useEffect(() => saveOpenClients(openClients), [openClients]);

  // Pins and hidden projects are the same per-user settings as the Projects page.
  const { pinnedIds, hiddenIds } = useMemo(() => {
    const pinnedIds = new Set<string>();
    const hiddenIds = new Set<string>();
    for (const p of prefs) {
      if (p.pinned_at) pinnedIds.add(p.project_id);
      if (p.hidden_at) hiddenIds.add(p.project_id);
    }
    return { pinnedIds, hiddenIds };
  }, [prefs]);

  const recents = useMemo<RecentTarget[]>(
    () => (open ? readRecents().filter((r) => !hiddenIds.has(r.project_id)) : []),
    [open, hiddenIds],
  );
  const q = search.trim().toLowerCase();

  // Browsing: pinned first, then a collapsible group per client (clients by
  // name, "No client" last). Hidden projects stay out until you search.
  const browse = useMemo(() => {
    if (!catalog) return { pinned: [], groups: [] as ClientGroup[], hiddenCount: 0 };
    const visible = catalog.projects.filter((p) => !hiddenIds.has(p.id));
    const pinned = visible.filter((p) => pinnedIds.has(p.id)).sort(byName);
    const byKey = new Map<string, ClientGroup>();
    for (const p of visible) {
      if (pinnedIds.has(p.id)) continue;
      const key = p.client_id ?? NO_CLIENT_KEY;
      const g = byKey.get(key);
      if (g) g.projects.push(p);
      else byKey.set(key, { key, name: p.client_id ? (p.client_name ?? '—') : null, projects: [p] });
    }
    const groups = Array.from(byKey.values()).sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return nameCollator.compare(a.name, b.name);
    });
    for (const g of groups) g.projects.sort(byName);
    return { pinned, groups, hiddenCount: catalog.projects.length - visible.length };
  }, [catalog, pinnedIds, hiddenIds]);

  // Searching: every project, hidden ones included (marked, and listed last).
  const searchProjects = useMemo(() => {
    if (!catalog || !q) return [];
    return catalog.projects
      .filter((p) => `${p.client_name ?? ''} ${p.name}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          rankOf(a.id, pinnedIds, hiddenIds) - rankOf(b.id, pinnedIds, hiddenIds) || byName(a, b),
      );
  }, [catalog, q, pinnedIds, hiddenIds]);

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
    out.sort(
      (a, b) =>
        rankOf(a.project.id, pinnedIds, hiddenIds) - rankOf(b.project.id, pinnedIds, hiddenIds),
    );
    return out.slice(0, 200);
  }, [catalog, q, pinnedIds, hiddenIds]);

  // Suggestion to use search text as custom task on a sensible project
  const customSuggestion = useMemo(() => {
    if (!catalog || !q || q.length < 2 || catalog.projects.length === 0) return null;
    const targetProj =
      catalog.projects.find((p) => p.id === value?.project_id) ??
      catalog.projects.find((p) => p.id === recents[0]?.project_id) ??
      browse.pinned[0] ??
      catalog.projects.find((p) => !hiddenIds.has(p.id)) ??
      catalog.projects[0];
    return { project: targetProj, text: search.trim() };
  }, [catalog, q, search, value?.project_id, recents, browse.pinned, hiddenIds]);

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
  function toggleClient(key: string) {
    setOpenClients((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const renderProject = (p: TrackerCatalogProject, showClient: boolean) => (
    <ProjectRow
      key={p.id}
      project={p}
      catalog={catalog!}
      showClient={showClient}
      pinned={pinnedIds.has(p.id)}
      hidden={hiddenIds.has(p.id)}
      expanded={expanded.has(p.id)}
      onToggle={() => toggleProject(p.id)}
      onPickProject={() => pickProject(p)}
      onPickWorkItem={(wi) => pickWorkItem(p, wi)}
      onPickCustom={(text) => pickCustom(p, text)}
      value={value}
    />
  );

  // A single client group needs no collapsing.
  const singleGroup = browse.groups.length === 1;

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

            {!q && browse.pinned.length > 0 && (
              <Section icon={<Pin size={12} />} label={t('tracker.pinned')}>
                {browse.pinned.map((p) => renderProject(p, true))}
              </Section>
            )}

            {/* Projects by client — click a project = pick-with-no-task */}
            {!q && browse.groups.length > 0 && (
              <Section icon={<Briefcase size={12} />} label={t('tracker.projects')}>
                {browse.groups.map((g) => {
                  const isOpen = singleGroup || openClients.has(g.key);
                  return (
                    <div key={g.key}>
                      {!singleGroup && (
                        <button
                          type="button"
                          onClick={() => toggleClient(g.key)}
                          aria-expanded={isOpen}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-left text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <Building2 size={12} className="text-neutral-400 dark:text-neutral-500" />
                          <span className="truncate font-medium">{g.name ?? t('tracker.noClient')}</span>
                          <span className="text-[11px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                            {g.projects.length}
                          </span>
                        </button>
                      )}
                      {isOpen && (
                        <div className={singleGroup ? '' : 'ml-4 border-l border-neutral-200 dark:border-neutral-800 pl-1'}>
                          {g.projects.map((p) => renderProject(p, singleGroup))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {!q && browse.hiddenCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                <EyeOff size={11} />
                {t('tracker.hiddenProjectsHint', { count: browse.hiddenCount })}
              </div>
            )}

            {/* Project matches when searching */}
            {q && searchProjects.length > 0 && (
              <Section icon={<Briefcase size={12} />} label={t('tracker.projects')}>
                {searchProjects.map((p) => renderProject(p, true))}
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
                    {hiddenIds.has(project.id) && <HiddenMark />}
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

            {!isLoading && q && searchProjects.length === 0 && taskResults.length === 0 && !customSuggestion && (
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

// Search order: pinned, then ordinary, then hidden projects.
function rankOf(id: string, pinned: Set<string>, hidden: Set<string>): number {
  return pinned.has(id) ? 0 : hidden.has(id) ? 2 : 1;
}

function HiddenMark() {
  const t = useT();
  return (
    <span title={t('tracker.hiddenProject')} className="shrink-0 text-neutral-400 dark:text-neutral-500">
      <EyeOff size={12} />
    </span>
  );
}

function readOpenClients(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_CLIENTS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveOpenClients(s: Set<string>) {
  try {
    localStorage.setItem(OPEN_CLIENTS_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // Storage unavailable — groups just won't stay open across visits.
  }
}

// ----- Project row (collapsible) ---------------------------------------------

function ProjectRow({
  project,
  catalog,
  showClient,
  pinned,
  hidden,
  expanded,
  onToggle,
  onPickProject,
  onPickWorkItem,
  onPickCustom,
  value,
}: {
  project: TrackerCatalogProject;
  catalog: TrackerCatalog;
  /** Off under a client heading, which already names the client. */
  showClient: boolean;
  pinned: boolean;
  hidden: boolean;
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
      {/* The project name opens its tasks — what you usually want; picking
          the project with no task is the smaller button at the end. */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? t('tracker.collapseTasks') : t('tracker.expandTasks')}
          className={[
            'flex-1 min-w-0 flex items-center gap-1.5 px-2 py-2 rounded-l text-sm text-left',
            active ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ].join(' ')}
        >
          <span className={['shrink-0 text-neutral-500 dark:text-neutral-400', hasTasks ? '' : 'opacity-40'].join(' ')}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <PathSegments parts={showClient ? [project.client_name ?? '—', project.name] : [project.name]} />
          {pinned && <Pin size={11} className="shrink-0 text-amber-600 dark:text-amber-400" fill="currentColor" />}
          {hidden && <HiddenMark />}
        </button>
        <button
          type="button"
          onClick={onPickProject}
          title={t('tracker.noTask')}
          className={[
            'shrink-0 h-9 px-2.5 rounded-r text-[11px]',
            active
              ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100',
          ].join(' ')}
        >
          {t('tracker.noTask')}
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
  title?: string;
}

export function TaskTargetTrigger({ value, catalog, onClick, onClear, placeholder, title }: TriggerProps) {
  const t = useT();
  const label = useMemo(() => {
    if (!value || !catalog) return null;
    return labelForTarget(value, catalog);
  }, [value, catalog]);

  const button = (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 min-w-0 flex items-center gap-2 px-3 h-9 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
    >
      {label ? (
        <PathSegments parts={label} />
      ) : (
        <span className="text-neutral-400 dark:text-neutral-500">{placeholder ?? t('tracker.pickTarget')}</span>
      )}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5">
      {/* The path is truncated to fit, so hovering shows it in full. */}
      {label || title ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-md break-words">
            {label && <TargetPathText parts={label} />}
            {title && <div className={label ? 'mt-1 opacity-70' : ''}>{title}</div>}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
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

// Full "Client › Project › Task" text for tooltips; the last segment stands out.
export function TargetPathText({ parts }: { parts: string[] }) {
  return (
    <div>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="opacity-60"> › </span>}
          <span className={i === parts.length - 1 ? 'font-medium' : ''}>{p}</span>
        </span>
      ))}
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
