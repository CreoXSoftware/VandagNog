import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Briefcase, Building2, Check, ChevronRight, EyeOff, ListChecks, Pin, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useProjectPrefs } from '@/hooks/useProjects';
import {
  useOrgTrackerCatalog,
  useTrackerCatalog,
  workItemPath,
  type TrackerCatalogProject,
  type TrackerCatalogWorkItem,
} from '@/hooks/useTrackerCatalog';
import type { TrackerTarget } from '@/types/db';

type Segment = 'client' | 'project' | 'task';

const NO_CLIENT = '__none__';
// Same ordering as the Projects page: case-insensitive, numeric-aware names.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

interface Props {
  value: TrackerTarget | null;
  onPick: (t: TrackerTarget) => void;
  /** Absent when the selection may not be emptied (a running timer). */
  onClear?: () => void;
  /** Opens the full picker: recents, and search across every project. */
  onSearch: () => void;
  disabled?: boolean;
  /** Extra hover text for every part. */
  title?: string;
}

// Client › Project › Task as three menus side by side, so one part can be
// changed without going through the others. Picking a client moves on to its
// projects, and a project to its tasks.
export function TargetSegments({ value, onPick, onClear, onSearch, disabled, title }: Props) {
  const t = useT();
  // Labels come from everything you can see (a running timer may be on another
  // organization's project); the menus offer the current organization only.
  const { data: all } = useTrackerCatalog();
  const { data: org } = useOrgTrackerCatalog();
  const { data: prefs = [] } = useProjectPrefs();

  const [open, setOpen] = useState<Segment | null>(null);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  // A client picked before one of its projects. It only holds while the target
  // is still what it was when the client was picked.
  const [pending, setPending] = useState<{ client: string; forKey: string } | null>(null);

  // Pins and hidden projects are the same per-user settings as the Projects page.
  const { pinned, hidden } = useMemo(() => {
    const pinned = new Set<string>();
    const hidden = new Set<string>();
    for (const p of prefs) {
      if (p.pinned_at) pinned.add(p.project_id);
      if (p.hidden_at) hidden.add(p.project_id);
    }
    return { pinned, hidden };
  }, [prefs]);

  // Pinned first, hidden last, then by name.
  const projects = useMemo(() => {
    const rank = (id: string) => (pinned.has(id) ? 0 : hidden.has(id) ? 2 : 1);
    return [...(org?.projects ?? [])].sort(
      (a, b) => rank(a.id) - rank(b.id) || nameCollator.compare(a.name, b.name),
    );
  }, [org, pinned, hidden]);

  const key = targetKey(value);
  const project = value ? all?.projects.find((p) => p.id === value.project_id) : undefined;
  const projectClient = project ? clientKeyOf(project) : null;
  const pendingClient = pending?.forKey === key ? pending.client : null;
  const client = pendingClient ?? projectClient;
  const shownProject =
    project && (pendingClient === null || pendingClient === projectClient) ? project : undefined;
  const current = shownProject && value?.project_id === shownProject.id ? value : null;

  function clientName(k: string): string {
    if (k === NO_CLIENT) return t('tracker.noClient');
    if (project?.client_id === k && project.client_name) return project.client_name;
    return all?.clients.find((c) => c.id === k)?.name ?? '—';
  }

  const taskPath =
    current?.work_item_id && all ? workItemPath(current.work_item_id, all.workItems) : [];
  const taskLabel = !current
    ? null
    : current.work_item_id
      ? (taskPath[taskPath.length - 1] ?? '—')
      : current.custom_task_text
        ? `“${current.custom_task_text}”`
        : t('tracker.noTask');

  // ---- Picking ---------------------------------------------------------------

  function pickClient(k: string) {
    if (k === projectClient) {
      setPending(null);
      setOpen('project');
      return;
    }
    const choices = projects.filter((p) => clientKeyOf(p) === k && !hidden.has(p.id));
    if (choices.length === 1) {
      pickProject(choices[0]);
      return;
    }
    if (onClear) {
      setPending({ client: k, forKey: targetKey(null) });
      onClear();
    } else {
      // A running timer keeps its project until a new one is picked.
      setPending({ client: k, forKey: key });
    }
    setOpen('project');
  }

  function pickProject(p: TrackerCatalogProject) {
    setPending(null);
    if (value?.project_id !== p.id) onPick({ project_id: p.id, work_item_id: null, custom_task_text: null });
    const hasTasks = (all?.workItems ?? []).some((w) => w.project_id === p.id);
    setOpen(hasTasks ? 'task' : null);
  }

  function pickTask(workItemId: string | null, customText: string | null) {
    if (!shownProject) return;
    onPick({ project_id: shownProject.id, work_item_id: workItemId, custom_task_text: customText });
    setOpen(null);
  }

  function onMenuOpenChange(seg: Segment, v: boolean) {
    setOpen((cur) => (v ? seg : cur === seg ? null : cur));
    // Walking away from a running timer's project menu leaves its client as it was.
    if (!v && seg === 'project' && !onClear) setPending(null);
  }

  // ---- Menus ---------------------------------------------------------------

  function clientOptions(raw: string): MenuOption[] {
    const q = raw.toLowerCase();
    const groups = new Map<string, { name: string; count: number }>();
    for (const p of projects) {
      // Hidden projects stay out until you search, as in the full picker.
      if (!q && hidden.has(p.id)) continue;
      const k = clientKeyOf(p);
      const g = groups.get(k);
      if (g) g.count += 1;
      else groups.set(k, { name: k === NO_CLIENT ? t('tracker.noClient') : (p.client_name ?? '—'), count: 1 });
    }
    return [...groups.entries()]
      .filter(([, g]) => !q || g.name.toLowerCase().includes(q))
      .sort(([ka, a], [kb, b]) =>
        ka === NO_CLIENT ? 1 : kb === NO_CLIENT ? -1 : nameCollator.compare(a.name, b.name),
      )
      .map(([k, g]) => ({
        key: k,
        label: g.name,
        muted: k === NO_CLIENT,
        hint: String(g.count),
        selected: k === client,
        onSelect: () => pickClient(k),
      }));
  }

  function projectOptions(raw: string): MenuOption[] {
    const q = raw.toLowerCase();
    const matches = (p: TrackerCatalogProject) =>
      !q || p.name.toLowerCase().includes(q) || (p.client_name ?? '').toLowerCase().includes(q);
    const inClient = (p: TrackerCatalogProject) => client === null || clientKeyOf(p) === client;
    const option = (p: TrackerCatalogProject, withClient: boolean): MenuOption => ({
      key: p.id,
      label: p.name,
      hint: withClient ? (p.client_name ?? t('tracker.noClient')) : undefined,
      pinned: pinned.has(p.id),
      hidden: hidden.has(p.id),
      selected: p.id === shownProject?.id,
      onSelect: () => pickProject(p),
    });

    let own = projects.filter((p) => inClient(p) && matches(p));
    if (!q) {
      const visible = own.filter((p) => !hidden.has(p.id));
      // A client whose projects are all hidden still lists them.
      if (visible.length > 0) own = visible;
    }
    const out = own.map((p) => option(p, client === null));
    // Searching also reaches the other clients' projects.
    if (q && client !== null) {
      const others = projects.filter((p) => !inClient(p) && matches(p));
      if (others.length > 0) {
        out.push({ key: '__others__', label: t('tracker.segments.otherClients'), heading: true });
        out.push(...others.map((p) => option(p, true)));
      }
    }
    return out;
  }

  function taskOptions(raw: string): MenuOption[] {
    if (!shownProject) return [];
    const q = raw.toLowerCase();
    const out: MenuOption[] = [];
    if (!q) {
      out.push({
        key: '__none__',
        label: t('tracker.noTask'),
        muted: true,
        selected: !!current && !current.work_item_id && !current.custom_task_text,
        onSelect: () => pickTask(null, null),
      });
      const custom = current?.custom_task_text;
      if (custom) {
        out.push({
          key: '__current__',
          label: `“${custom}”`,
          selected: true,
          onSelect: () => pickTask(null, custom),
        });
      }
    }
    const rows = flattenTasks((all?.workItems ?? []).filter((w) => w.project_id === shownProject.id));
    for (const r of rows) {
      if (q && !r.path.join(' ').toLowerCase().includes(q)) continue;
      out.push({
        key: r.item.id,
        label: r.item.name,
        // Matches lose the tree, so they say where they sit instead.
        depth: q ? 0 : r.depth,
        hint: q && r.path.length > 1 ? r.path.slice(0, -1).join(' › ') : undefined,
        selected: current?.work_item_id === r.item.id,
        onSelect: () => pickTask(r.item.id, null),
      });
    }
    if (raw) {
      out.push({
        key: '__custom__',
        label: `“${raw}”`,
        hint: t('tracker.useAsCustom'),
        onSelect: () => pickTask(null, raw),
      });
    }
    return out;
  }

  const withTitle = (text: string | null) => [text, title].filter(Boolean).join('\n') || undefined;
  // Moving on to the next part's menu: focus goes there, not back to this trigger.
  const keepFocus = () => openRef.current !== null;

  return (
    <div
      className={cn(
        'flex items-center h-9 min-w-0 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onSearch}
        disabled={disabled}
        aria-label={t('tracker.segments.searchAll')}
        title={t('tracker.segments.searchAll')}
        className="h-full px-2.5 shrink-0 flex items-center rounded-l-md border-r border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-500 enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800 enabled:hover:text-neutral-700 dark:enabled:hover:text-neutral-200"
      >
        <Search size={14} />
      </button>

      <SegmentMenu
        open={open === 'client'}
        onOpenChange={(v) => onMenuOpenChange('client', v)}
        keepFocus={keepFocus}
        placeholder={t('tracker.segments.client')}
        options={clientOptions}
        trigger={
          <SegmentButton
            icon={<Building2 size={13} />}
            label={client ? clientName(client) : null}
            placeholder={t('tracker.client')}
            disabled={disabled}
            title={withTitle(client ? clientName(client) : null)}
            className="flex-[0_1_auto] max-w-[30%]"
          />
        }
      />
      <Separator />
      <SegmentMenu
        open={open === 'project'}
        onOpenChange={(v) => onMenuOpenChange('project', v)}
        keepFocus={keepFocus}
        placeholder={t('tracker.segments.project')}
        options={projectOptions}
        trigger={
          <SegmentButton
            icon={<Briefcase size={13} />}
            label={shownProject?.name ?? null}
            placeholder={t('tracker.project')}
            disabled={disabled}
            title={withTitle(shownProject?.name ?? null)}
            className="flex-[0_1_auto] max-w-[36%]"
          />
        }
      />
      <Separator />
      <SegmentMenu
        open={open === 'task'}
        onOpenChange={(v) => onMenuOpenChange('task', v)}
        keepFocus={keepFocus}
        placeholder={t('tracker.segments.task')}
        options={taskOptions}
        trigger={
          <SegmentButton
            icon={<ListChecks size={13} />}
            label={taskLabel}
            placeholder={t('tracker.task')}
            disabled={disabled || !shownProject}
            title={withTitle(taskPath.length > 1 ? taskPath.join(' › ') : taskLabel)}
            className="flex-1"
          />
        }
      />

      {value && onClear && (
        <button
          type="button"
          onClick={() => {
            setPending(null);
            onClear();
          }}
          disabled={disabled}
          aria-label={t('tracker.clearTarget')}
          title={t('tracker.clearTarget')}
          className="h-full px-2 shrink-0 flex items-center rounded-r-md text-neutral-400 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function targetKey(t: TrackerTarget | null): string {
  return t ? `${t.project_id}|${t.work_item_id ?? ''}|${t.custom_task_text ?? ''}` : '';
}

function clientKeyOf(p: TrackerCatalogProject): string {
  return p.client_id ?? NO_CLIENT;
}

// A project's tasks in outline order, each with its name path.
function flattenTasks(
  items: TrackerCatalogWorkItem[],
): { item: TrackerCatalogWorkItem; depth: number; path: string[] }[] {
  const ids = new Set(items.map((w) => w.id));
  const kids = new Map<string | null, TrackerCatalogWorkItem[]>();
  for (const w of items) {
    const parent = w.parent_id && ids.has(w.parent_id) ? w.parent_id : null;
    const arr = kids.get(parent);
    if (arr) arr.push(w);
    else kids.set(parent, [w]);
  }
  for (const arr of kids.values()) arr.sort((a, b) => a.position - b.position);

  const out: { item: TrackerCatalogWorkItem; depth: number; path: string[] }[] = [];
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const w of kids.get(parent) ?? []) {
      const p = [...path, w.name];
      out.push({ item: w, depth, path: p });
      walk(w.id, depth + 1, p);
    }
  };
  walk(null, 0, []);
  return out;
}

function Separator() {
  return <ChevronRight size={12} className="shrink-0 text-neutral-300 dark:text-neutral-600" aria-hidden />;
}

interface SegmentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string | null;
  placeholder: string;
}

// Radix's Trigger hands its props and ref through, so they are spread on.
const SegmentButton = forwardRef<HTMLButtonElement, SegmentButtonProps>(
  ({ icon, label, placeholder, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        'h-full min-w-0 flex items-center gap-1.5 px-2 text-left',
        'enabled:hover:bg-neutral-100 dark:enabled:hover:bg-neutral-800 disabled:cursor-default',
        'data-[state=open]:bg-neutral-100 dark:data-[state=open]:bg-neutral-800',
        className,
      )}
    >
      <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{icon}</span>
      {label ? (
        <span className="truncate text-neutral-900 dark:text-neutral-100">{label}</span>
      ) : (
        <span className="truncate text-neutral-400 dark:text-neutral-500">{placeholder}</span>
      )}
    </button>
  ),
);
SegmentButton.displayName = 'SegmentButton';

// ----- Menu --------------------------------------------------------------------

interface MenuOption {
  key: string;
  label: string;
  /** Muted text at the end: a count, a parent path, another client's name. */
  hint?: string;
  depth?: number;
  /** A group heading rather than something to pick. */
  heading?: boolean;
  /** "No client" / "No task": an absence, set apart from real names. */
  muted?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

function SegmentMenu({
  open,
  onOpenChange,
  keepFocus,
  placeholder,
  options,
  trigger,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keepFocus: () => boolean;
  placeholder: string;
  /** The options for what has been typed into the menu's search box. */
  options: (query: string) => MenuOption[];
  trigger: React.ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            if (keepFocus()) e.preventDefault();
          }}
          className="z-50 w-72 max-w-[calc(100vw-16px)] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg text-neutral-900 dark:text-neutral-100"
        >
          {/* Mounted with the content, so every opening starts unfiltered. */}
          <MenuBody options={options} placeholder={placeholder} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuBody({
  options,
  placeholder,
}: {
  options: (query: string) => MenuOption[];
  placeholder: string;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const query = q.trim();
  const list = options(query);
  let next = 0;
  const rows = list.map((o) => ({ o, idx: o.onSelect ? next++ : -1 }));
  const picks = rows.filter((r) => r.idx >= 0).map((r) => r.o);

  // Starts on the current choice; typing moves it back to the first match.
  const [cursor, setCursor] = useState(() => ({
    q: '',
    i: Math.max(0, picks.findIndex((o) => o.selected)),
  }));
  const active = picks.length === 0 ? -1 : Math.min(cursor.q === query ? cursor.i : 0, picks.length - 1);

  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (picks.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor({ q: query, i: (active + step + picks.length) % picks.length });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      picks[active]?.onSelect?.();
    }
  }

  return (
    <>
      <div className="p-1.5 border-b border-neutral-100 dark:border-neutral-800">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full h-8 px-2 rounded bg-neutral-50 dark:bg-neutral-950 text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:ring-1 focus:ring-neutral-300 dark:focus:ring-neutral-700"
        />
      </div>
      <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {picks.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            {t('tracker.noResults')}
          </div>
        )}
        {rows.map(({ o, idx }) =>
          o.heading ? (
            <div
              key={o.key}
              className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
            >
              {o.label}
            </div>
          ) : (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={!!o.selected}
              data-idx={idx}
              onMouseMove={() => idx !== active && setCursor({ q: query, i: idx })}
              onClick={o.onSelect}
              className={cn(
                'w-full flex items-center gap-1.5 pr-2 py-1.5 rounded text-sm text-left',
                idx === active && 'bg-neutral-100 dark:bg-neutral-800',
              )}
              style={{ paddingLeft: 8 + (o.depth ?? 0) * 14 }}
            >
              <span
                className={cn(
                  'truncate',
                  o.muted && 'italic text-neutral-500 dark:text-neutral-400',
                  o.selected && 'font-medium',
                )}
              >
                {o.label}
              </span>
              {o.pinned && (
                <Pin size={11} className="shrink-0 text-amber-600 dark:text-amber-400" fill="currentColor" />
              )}
              {o.hidden && <EyeOff size={11} className="shrink-0 text-neutral-400 dark:text-neutral-500" />}
              <span className="ml-auto flex items-center gap-1.5 pl-2 min-w-0 max-w-[55%]">
                {o.hint && (
                  <span className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">{o.hint}</span>
                )}
                {o.selected && <Check size={12} className="shrink-0 text-neutral-500 dark:text-neutral-400" />}
              </span>
            </button>
          ),
        )}
      </div>
    </>
  );
}
