import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n';
import {
  useCreateWorkItem,
  useReorderWorkItems,
  useRescheduleFrom,
  useUpdateWorkItem,
} from '@/hooks/useWorkItems';
import type { TasksPerson } from '@/hooks/useTasksData';
import { toDateString, type WorkCalendar } from '@/components/gantt/ganttUtils';
import { computeSuccessorBinding } from '@/lib/cascade';
import { endDateFromStartAndDuration, workItemDurationLabel } from '@/lib/duration';
import { avatarHue } from '@/lib/userDisplay';
import { newId } from '@/lib/id';
import { quickKeyOf, type QuickKey } from '@/lib/platform';
import { seedDatesFor, snapIso, type TimeFilter } from '@/lib/tasksFilter';
import {
  buildOutline,
  childrenIndex,
  parentKey,
  previousSiblingRow,
  type DraftSpec,
  type OutlineRow,
} from '@/lib/taskOutline';
import {
  collectSubtreeIds,
  computeReparentUpdates,
  insertionPosition,
  type ReparentUpdate,
} from '@/lib/workItemTree';
import type { Dependency, WorkItem } from '@/types/db';
import { DraftRow, ItemRow, type DropPos } from './OutlineRow';
import { QuickEditPopover, type DurationPreview } from './QuickEditPopover';

export interface OutlineGroup {
  projectId: string;
  projectName: string;
  /** Every live item in the project — the tree is always built from all of them. */
  items: WorkItem[];
  /** Ids that pass the filters, plus their ancestors. */
  visible: Set<string>;
  openCount: number;
  doneCount: number;
  canEdit: boolean;
  /** Who a task created in this group is assigned to. */
  quickAddAssigneeId: string | null;
  calendar: WorkCalendar | undefined;
}

interface Props {
  groups: OutlineGroup[];
  dependencies: Dependency[];
  peopleById: Map<string, TasksPerson>;
  membership: Record<string, string[]>;
  me: string | null;
  today: string;
  when: TimeFilter;
  selectedId: string | undefined;
  collapsedProjects: Set<string>;
  onToggleProject: (projectId: string) => void;
  collapsedItems: Set<string>;
  setCollapsedItems: (update: (prev: Set<string>) => Set<string>) => void;
  /** Keep these ids on screen whatever the filters say, until the filters change. */
  pin: (ids: string[]) => void;
  onToggleDone: (item: WorkItem, done: boolean) => void;
  onOpen: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
}

interface DraftState {
  spec: DraftSpec;
  text: string;
  /** Identifies one draft line across re-renders; a new line gets a new token. */
  token: number;
}

const DRAFT_KEY = 'draft';
// How long a requested focus may wait for its row to (re)appear — long enough
// for an optimistic insert to land, short enough never to surprise anyone.
const FOCUS_WAIT_MS = 1500;

type ItemOutlineRow = Extract<OutlineRow, { kind: 'item' }>;

// The Tasks page as an outliner: every project's tree, edited in place.
//
// Typing happens in a "draft" line that only becomes a work item once it has a
// name, so Enter-Enter-Enter never leaves empty "New item" rows behind. Names
// are committed on blur. Structure changes (Tab, Shift+Tab, drag) go through the
// same position/parent updates as the gantt's tree.
export function TaskOutline(props: Props) {
  const {
    groups,
    dependencies,
    peopleById,
    membership,
    me,
    today,
    when,
    selectedId,
    collapsedProjects,
    onToggleProject,
    collapsedItems,
    setCollapsedItems,
    pin,
  } = props;
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';

  const create = useCreateWorkItem();
  const update = useUpdateWorkItem();
  const reorder = useReorderWorkItems();
  const reschedule = useRescheduleFrom();

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [popup, setPopup] = useState<{ id: string; mode: QuickKey } | null>(null);
  const [drag, setDrag] = useState<{ id: string; projectId: string; subtree: Set<string> } | null>(
    null,
  );
  const [over, setOver] = useState<{ id: string; pos: DropPos } | null>(null);

  const inputs = useRef(new Map<string, HTMLInputElement>());
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<{ key: string; timer: number } | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  // Draft tokens already turned into a task, or cancelled — their late blur
  // must not create anything.
  const settled = useRef(new Set<number>());
  const tokenSeq = useRef(0);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.projectId, g])), [groups]);
  const indexByProject = useMemo(
    () => new Map(groups.map((g) => [g.projectId, childrenIndex(g.items)])),
    [groups],
  );
  const draftSpec = draft?.spec ?? null;
  const rowsByProject = useMemo(
    () =>
      new Map(
        groups.map((g) => [
          g.projectId,
          buildOutline({
            items: g.items,
            visible: g.visible,
            collapsed: collapsedItems,
            draft: draftSpec?.projectId === g.projectId ? draftSpec : null,
          }),
        ]),
      ),
    [groups, collapsedItems, draftSpec],
  );

  // Keyboard navigation order across every expanded project.
  const flatKeys = useMemo(() => {
    const out: string[] = [];
    for (const g of groups) {
      if (collapsedProjects.has(g.projectId)) continue;
      for (const r of rowsByProject.get(g.projectId) ?? []) {
        out.push(r.kind === 'draft' ? DRAFT_KEY : r.item.id);
      }
    }
    return out;
  }, [groups, collapsedProjects, rowsByProject]);

  useLayoutEffect(() => {
    draftRef.current = draft;
  });

  // Re-apply a requested focus after each render until its row exists. Rows
  // can unmount and remount (a new parent's optimistic row landing a tick
  // later) or be moved in the DOM (outdent), and either drops focus.
  useLayoutEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const el = inputs.current.get(p.key);
    if (!el) return;
    const active = document.activeElement;
    if (active === el) return;
    // Only take focus back from nowhere (a moved or removed row leaves it on
    // body) or from another line of the outline — never from a popover, the
    // filters, or anything else the user went to.
    const fromOutline = [...inputs.current.values()].includes(active as HTMLInputElement);
    if (active && active !== document.body && !fromOutline) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  });

  // Any click elsewhere is the user taking focus somewhere on purpose.
  useEffect(() => {
    const clear = () => {
      pendingFocus.current = null;
    };
    document.addEventListener('pointerdown', clear, true);
    return () => document.removeEventListener('pointerdown', clear, true);
  }, []);

  function focusKey(key: string) {
    if (pendingFocus.current) window.clearTimeout(pendingFocus.current.timer);
    const timer = window.setTimeout(() => {
      if (pendingFocus.current?.timer === timer) pendingFocus.current = null;
    }, FOCUS_WAIT_MS);
    pendingFocus.current = { key, timer };
    const el = inputs.current.get(key);
    if (el && document.activeElement !== el) {
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }

  function openPopup(id: string, mode: QuickKey) {
    if (pendingFocus.current) window.clearTimeout(pendingFocus.current.timer);
    pendingFocus.current = null;
    setPopup({ id, mode });
  }

  function navigate(fromKey: string, dir: -1 | 1) {
    const i = flatKeys.indexOf(fromKey);
    const target = i < 0 ? undefined : flatKeys[i + dir];
    if (!target) return;
    pendingFocus.current = null;
    const el = inputs.current.get(target);
    if (el) {
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }

  function expand(id: string) {
    if (!collapsedItems.has(id)) return;
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleCollapsed(id: string) {
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function move(projectId: string, updates: ReparentUpdate[]) {
    if (updates.length === 0) return;
    reorder.mutate(
      { project_id: projectId, updates },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  // ---- Creating ------------------------------------------------------------

  // Dates for a new item. A child copies its neighbour's span (or, as the first
  // child, its parent's): the rollup trigger recomputes the parent from its
  // children, so this keeps the parent's span where it was instead of letting
  // a blank or far-off child stretch or blank it — same reasoning as the
  // gantt's addChild. A root task lands in the time filter you are looking at.
  function seedDates(
    g: OutlineGroup,
    parentId: string | null,
    siblings: WorkItem[],
    index: number,
  ): { start_date: string | null; end_date: string | null } {
    if (parentId) {
      const neighbour = siblings[index - 1] ?? siblings[index];
      if (neighbour?.start_date && neighbour.end_date) {
        return { start_date: neighbour.start_date, end_date: neighbour.end_date };
      }
      const parent = indexByProject.get(g.projectId)?.byId.get(parentId);
      if (parent?.start_date && parent.end_date) {
        return { start_date: parent.start_date, end_date: parent.end_date };
      }
    }
    const seed = seedDatesFor(when, today);
    if (!g.calendar) return seed;
    const start = snapIso(seed.start_date, g.calendar, 'forward');
    let end = snapIso(seed.end_date, g.calendar, 'backward');
    if (start && end && end < start) end = start;
    return { start_date: start, end_date: end };
  }

  function createFromSpec(spec: DraftSpec, name: string): string | null {
    const g = groupById.get(spec.projectId);
    const idx = indexByProject.get(spec.projectId);
    if (!g || !idx || !g.canEdit) return null;

    const siblings = idx.kids.get(spec.parentId) ?? [];
    let index = siblings.length;
    if (spec.anchor.kind === 'first') index = 0;
    else if (spec.anchor.kind === 'after') {
      const anchorId = spec.anchor.id;
      const i = siblings.findIndex((w) => w.id === anchorId);
      if (i >= 0) index = i + 1;
    }
    const { position, renumber } = insertionPosition(siblings, index);
    const dates = seedDates(g, spec.parentId, siblings, index);

    const id = newId();
    pin([id]);
    move(spec.projectId, renumber);
    create.mutate(
      {
        // Client-generated so the optimistic row is the real row, and so the
        // next draft line can anchor to it straight away.
        id,
        project_id: spec.projectId,
        parent_id: spec.parentId,
        name,
        start_date: dates.start_date,
        end_date: dates.end_date,
        position,
        assignee_id: g.quickAddAssigneeId,
      },
      { onError: (e) => toast.error((e as Error).message || t('tasks.addFailed')) },
    );
    return id;
  }

  // ---- Draft line ----------------------------------------------------------

  function startDraft(spec: DraftSpec, text = '', keepToken?: number) {
    if (spec.parentId) expand(spec.parentId);
    const token = keepToken ?? ++tokenSeq.current;
    setDraft({ spec, text, token });
    focusKey(DRAFT_KEY);
  }

  function cancelDraft(focusPrevious: boolean) {
    if (!draft) return;
    settled.current.add(draft.token);
    if (focusPrevious) {
      const i = flatKeys.indexOf(DRAFT_KEY);
      const prev = i > 0 ? flatKeys[i - 1] : undefined;
      if (prev) focusKey(prev);
    }
    setDraft(null);
  }

  function draftRowIndex(projectId: string): number {
    return (rowsByProject.get(projectId) ?? []).findIndex((r) => r.kind === 'draft');
  }

  function indentDraft() {
    if (!draft) return;
    const rows = rowsByProject.get(draft.spec.projectId) ?? [];
    const prev = previousSiblingRow(rows, draftRowIndex(draft.spec.projectId));
    if (!prev || prev.kind !== 'item') return;
    startDraft(
      { projectId: draft.spec.projectId, parentId: prev.item.id, anchor: { kind: 'end' } },
      draft.text,
      draft.token,
    );
  }

  function outdentDraft() {
    if (!draft || !draft.spec.parentId) return;
    const idx = indexByProject.get(draft.spec.projectId);
    const parent = idx?.byId.get(draft.spec.parentId);
    if (!idx || !parent) return;
    startDraft(
      {
        projectId: draft.spec.projectId,
        parentId: parentKey(parent, idx.byId),
        anchor: { kind: 'after', id: parent.id },
      },
      draft.text,
      draft.token,
    );
  }

  function onDraftKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!draft) return;
    const { spec, text, token } = draft;
    const name = text.trim();

    const quick = quickKeyOf(e);
    if (quick) {
      e.preventDefault();
      if (!name) return;
      settled.current.add(token);
      const id = createFromSpec(spec, name);
      setDraft(null);
      if (id) openPopup(id, quick);
      return;
    }

    // Enter (with or without Shift) adds a line on the same level; Tab and
    // Shift+Tab are how a line changes level.
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter on an empty sub-task line steps out a level, then out of the list.
      if (!name) {
        if (spec.parentId) outdentDraft();
        else cancelDraft(true);
        return;
      }
      settled.current.add(token);
      const id = createFromSpec(spec, name);
      if (id) {
        startDraft({ projectId: spec.projectId, parentId: spec.parentId, anchor: { kind: 'after', id } });
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdentDraft();
      else indentDraft();
      return;
    }
    if (e.key === 'Escape' || (e.key === 'Backspace' && !text)) {
      e.preventDefault();
      cancelDraft(true);
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
      e.preventDefault();
      navigate(DRAFT_KEY, e.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // Leaving the line keeps what was typed. Deferred one tick because a blur is
  // also what the browser fires when the line is merely moved in the DOM
  // (indent/outdent) — by then the focus effect has put the cursor back.
  function onDraftBlur() {
    const snap = draftRef.current;
    if (!snap) return;
    window.setTimeout(() => {
      const cur = draftRef.current;
      const same = cur?.token === snap.token;
      if (same && document.activeElement === inputs.current.get(DRAFT_KEY)) return;
      if (same && pendingFocus.current?.key === DRAFT_KEY) return;
      if (!settled.current.has(snap.token)) {
        settled.current.add(snap.token);
        const name = snap.text.trim();
        if (name) createFromSpec(snap.spec, name);
      }
      if (same) setDraft(null);
    }, 0);
  }

  // ---- Existing rows -------------------------------------------------------

  function indent(row: ItemOutlineRow, g: OutlineGroup) {
    const rows = rowsByProject.get(g.projectId) ?? [];
    // The sibling directly above as shown, so a filtered-out sibling is never
    // the surprise new parent.
    const prev = previousSiblingRow(rows, rows.indexOf(row));
    if (!prev || prev.kind !== 'item') return;
    expand(prev.item.id);
    pin([row.item.id]);
    move(
      g.projectId,
      computeReparentUpdates({
        items: g.items,
        draggedId: row.item.id,
        newParentId: prev.item.id,
        targetId: null,
        placeAfter: true,
      }),
    );
    focusKey(row.item.id);
  }

  function outdent(row: ItemOutlineRow, g: OutlineGroup) {
    const idx = indexByProject.get(g.projectId);
    if (!row.parentId || !idx) return;
    const parent = idx.byId.get(row.parentId);
    if (!parent) return;
    pin([row.item.id]);
    move(
      g.projectId,
      computeReparentUpdates({
        items: g.items,
        draggedId: row.item.id,
        newParentId: parentKey(parent, idx.byId),
        targetId: parent.id,
        placeAfter: true,
      }),
    );
    focusKey(row.item.id);
  }

  // Alt+Shift+↑/↓: swap with the visible sibling above/below.
  function shift(row: ItemOutlineRow, g: OutlineGroup, dir: -1 | 1) {
    const siblings = (rowsByProject.get(g.projectId) ?? []).filter(
      (r): r is ItemOutlineRow => r.kind === 'item' && r.parentId === row.parentId,
    );
    const i = siblings.indexOf(row);
    const target = siblings[i + dir];
    if (!target) return;
    move(
      g.projectId,
      computeReparentUpdates({
        items: g.items,
        draggedId: row.item.id,
        newParentId: row.item.parent_id ?? null,
        targetId: target.item.id,
        placeAfter: dir === 1,
      }),
    );
    focusKey(row.item.id);
  }

  function onRowKey(e: React.KeyboardEvent<HTMLInputElement>, row: ItemOutlineRow, g: OutlineGroup) {
    const quick = quickKeyOf(e);
    if (quick) {
      e.preventDefault();
      if (g.canEdit) openPopup(row.item.id, quick);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      e.preventDefault();
      if (e.altKey && e.shiftKey) {
        if (g.canEdit) shift(row, g, dir);
      } else if (!e.altKey && !e.metaKey && !e.ctrlKey) {
        navigate(row.item.id, dir);
      }
      return;
    }
    if (!g.canEdit) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      startDraft({
        projectId: g.projectId,
        parentId: row.parentId,
        anchor: { kind: 'after', id: row.item.id },
      });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent(row, g);
      else indent(row, g);
    }
  }

  function rename(item: WorkItem, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) return;
    pin([item.id]);
    update.mutate(
      { id: item.id, project_id: item.project_id, patch: { name: trimmed } },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  // ---- Drag and drop -------------------------------------------------------

  function onDragStart(e: React.DragEvent, row: ItemOutlineRow, g: OutlineGroup) {
    if (!g.canEdit) {
      e.preventDefault();
      return;
    }
    setDrag({
      id: row.item.id,
      projectId: g.projectId,
      subtree: collectSubtreeIds(g.items, row.item.id),
    });
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', row.item.name);
    } catch {
      /* some browsers refuse custom data during dragstart */
    }
    const el = rowEls.current.get(row.item.id);
    if (el) e.dataTransfer.setDragImage(el, 16, 18);
  }

  function onDragOver(e: React.DragEvent, row: ItemOutlineRow, g: OutlineGroup) {
    // Moving between projects would orphan dependencies and memberships, so a
    // drag only ever lands inside its own project.
    if (!drag || drag.projectId !== g.projectId || drag.subtree.has(row.item.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pos: DropPos = y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'on';
    if (over?.id !== row.item.id || over.pos !== pos) setOver({ id: row.item.id, pos });
  }

  function endDrag() {
    setDrag(null);
    setOver(null);
  }

  function onDrop(e: React.DragEvent, row: ItemOutlineRow, g: OutlineGroup) {
    e.preventDefault();
    const d = drag;
    const o = over;
    endDrag();
    if (!d || !o || o.id !== row.item.id || d.subtree.has(row.item.id)) return;
    const idx = indexByProject.get(g.projectId);
    if (!idx) return;

    let newParentId: string | null;
    let targetId: string | null;
    let placeAfter: boolean;
    if (o.pos === 'on') {
      newParentId = row.item.id;
      targetId = null;
      placeAfter = true;
      expand(row.item.id);
    } else if (o.pos === 'after' && row.visibleChildren > 0 && !row.collapsed) {
      // Just below an open summary row reads as "first child", not as "after
      // its whole subtree", which is where a sibling would actually land.
      newParentId = row.item.id;
      targetId = (idx.kids.get(row.item.id) ?? []).find((w) => w.id !== d.id)?.id ?? null;
      placeAfter = false;
    } else {
      newParentId = row.parentId;
      targetId = row.item.id;
      placeAfter = o.pos === 'after';
    }
    pin([d.id]);
    move(
      g.projectId,
      computeReparentUpdates({ items: g.items, draggedId: d.id, newParentId, targetId, placeAfter }),
    );
  }

  // ---- Quick edit ----------------------------------------------------------

  const popupTarget = (() => {
    if (!popup) return null;
    for (const g of groups) {
      const idx = indexByProject.get(g.projectId);
      const item = idx?.byId.get(popup.id);
      if (item) return { item, g, isParent: (idx?.kids.get(item.id) ?? []).length > 0 };
    }
    return null;
  })();

  // Back to the row so the next Enter / shortcut carries on from there — unless
  // the popover closed because something else was clicked, which keeps focus.
  function closePopup() {
    const id = popup?.id;
    setPopup(null);
    if (!id) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const el = inputs.current.get(id);
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
  }

  function projectDeps(projectId: string): Dependency[] {
    return dependencies.filter((d) => d.project_id === projectId);
  }

  // The dates a duration would produce: keeps an existing start, otherwise
  // starts in the current time filter — but never before what its
  // predecessors allow.
  function durationPlan(item: WorkItem, g: OutlineGroup, workDays: number): DurationPreview | null {
    if (!g.calendar) return null;
    let start = item.start_date;
    if (!start) {
      const seed = seedDatesFor(when, today).start_date ?? today;
      start = snapIso(seed, g.calendar, 'forward') ?? seed;
      const b = computeSuccessorBinding({
        successorId: item.id,
        items: g.items,
        dependencies: projectDeps(g.projectId),
        calendar: g.calendar,
      });
      if (b.startBinding && toDateString(b.startBinding) > start) start = toDateString(b.startBinding);
    }
    const end = endDateFromStartAndDuration(start, workDays, g.calendar);
    return end ? { start, end } : null;
  }

  function saveDuration(item: WorkItem, g: OutlineGroup, workDays: number) {
    const plan = durationPlan(item, g, workDays);
    if (!plan || !g.calendar) return;
    // Same guard as the drawer: never hand reschedule_from dates that break an
    // incoming dependency.
    const b = computeSuccessorBinding({
      successorId: item.id,
      items: g.items,
      dependencies: projectDeps(g.projectId),
      calendar: g.calendar,
    });
    if (
      (b.startBinding && plan.start < toDateString(b.startBinding)) ||
      (b.endBinding && plan.end < toDateString(b.endBinding))
    ) {
      toast.error(t('cascade.violatesBinding'));
      return;
    }
    pin([item.id]);
    reschedule.mutate(
      { project_id: item.project_id, work_item_id: item.id, new_start: plan.start, new_end: plan.end },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  function patch(item: WorkItem, p: Partial<WorkItem>) {
    pin([item.id]);
    update.mutate(
      { id: item.id, project_id: item.project_id, patch: p },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  // ---- Render --------------------------------------------------------------

  return (
    <>
      {groups.map((g) => {
        const rows = rowsByProject.get(g.projectId) ?? [];
        const collapsed = collapsedProjects.has(g.projectId);
        const hue = avatarHue(g.projectId);
        const draftAtRootEnd =
          draft?.spec.projectId === g.projectId &&
          draft.spec.parentId === null &&
          draft.spec.anchor.kind === 'end';
        return (
          <section key={g.projectId} className="border-b border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => onToggleProject(g.projectId)}
              className="w-full flex items-center gap-2 px-3 h-10 bg-neutral-50 dark:bg-neutral-900/70 hover:bg-neutral-100 dark:hover:bg-neutral-900 sticky top-0 z-10"
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
              />
              <span className="text-sm font-medium truncate">{g.projectName}</span>
              {!g.canEdit && (
                <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                  {t('tasks.viewOnly')}
                </span>
              )}
              <span className="ml-auto text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                {t('tasks.openCount', { n: g.openCount })}
                {g.doneCount > 0 && ` · ${t('tasks.doneCount', { n: g.doneCount })}`}
              </span>
            </button>

            {!collapsed && (
              <div onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}>
                {rows.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                    {t('tasks.emptyProject')}
                  </div>
                )}
                {rows.map((r) =>
                  r.kind === 'draft' ? (
                    <DraftRow
                      key={DRAFT_KEY}
                      depth={r.depth}
                      value={draft?.text ?? ''}
                      onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
                      onKeyDown={onDraftKey}
                      onBlur={onDraftBlur}
                      registerInput={(el) => {
                        if (el) inputs.current.set(DRAFT_KEY, el);
                        else inputs.current.delete(DRAFT_KEY);
                      }}
                    />
                  ) : (
                    <ItemRow
                      key={r.item.id}
                      row={r}
                      canEdit={g.canEdit}
                      today={today}
                      locale={locale}
                      selected={selectedId === r.item.id}
                      isMine={!!me && r.item.assignee_id === me}
                      assignee={r.item.assignee_id ? peopleById.get(r.item.assignee_id) : undefined}
                      durationLabel={
                        g.calendar
                          ? workItemDurationLabel(
                              r.item.start_date,
                              r.item.end_date,
                              g.calendar,
                              r.item.duration_days,
                            )
                          : ''
                      }
                      drop={over?.id === r.item.id ? over.pos : null}
                      dragging={drag?.id === r.item.id}
                      registerInput={(el) => {
                        if (el) inputs.current.set(r.item.id, el);
                        else inputs.current.delete(r.item.id);
                      }}
                      registerRow={(el) => {
                        if (el) rowEls.current.set(r.item.id, el);
                        else rowEls.current.delete(r.item.id);
                      }}
                      onCommitName={(name) => rename(r.item, name)}
                      onKeyDown={(e) => onRowKey(e, r, g)}
                      onToggleDone={(done) => props.onToggleDone(r.item, done)}
                      onToggleCollapse={() => toggleCollapsed(r.item.id)}
                      onOpen={() => props.onOpen(r.item)}
                      onDelete={() => props.onDelete(r.item)}
                      onQuick={(mode) => g.canEdit && openPopup(r.item.id, mode)}
                      onDragStart={(e) => onDragStart(e, r, g)}
                      onDragEnd={endDrag}
                      onDragOver={(e) => onDragOver(e, r, g)}
                      onDrop={(e) => onDrop(e, r, g)}
                    />
                  ),
                )}
                {g.canEdit && g.calendar && !draftAtRootEnd && (
                  <button
                    type="button"
                    onClick={() =>
                      startDraft({ projectId: g.projectId, parentId: null, anchor: { kind: 'end' } })
                    }
                    className="w-full flex items-center gap-2 pl-3 pr-2 h-9 text-left text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  >
                    <Plus size={14} className="shrink-0" />
                    {t('tasks.addPlaceholder')}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {popup && popupTarget && (
        <QuickEditPopover
          key={popup.id}
          anchor={() => rowEls.current.get(popup.id)}
          item={popupTarget.item}
          mode={popup.mode}
          isParent={popupTarget.isParent}
          members={(membership[popupTarget.g.projectId] ?? [])
            .map((id) => peopleById.get(id))
            .filter((p): p is TasksPerson => !!p)}
          durationLabel={
            popupTarget.g.calendar
              ? workItemDurationLabel(
                  popupTarget.item.start_date,
                  popupTarget.item.end_date,
                  popupTarget.g.calendar,
                  popupTarget.item.duration_days,
                )
              : ''
          }
          locale={locale}
          previewDuration={(days) => durationPlan(popupTarget.item, popupTarget.g, days)}
          onModeChange={(mode) => setPopup({ id: popup.id, mode })}
          onClose={closePopup}
          onSaveDescription={(text) => patch(popupTarget.item, { description: text || null })}
          onSaveAssignee={(userId) => patch(popupTarget.item, { assignee_id: userId })}
          onSaveDuration={(days) => saveDuration(popupTarget.item, popupTarget.g, days)}
        />
      )}
    </>
  );
}
