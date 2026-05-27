import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, ZoomIn, ZoomOut, Plus, Trash2, ListPlus, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Dependency, NonWorkingDay, WorkItem } from '@/types/db';
import { useCreateWorkItem, useDeleteWorkItem, useReorderWorkItems, useRescheduleFrom, type ReorderUpdate } from '@/hooks/useWorkItems';
import { cn } from '@/lib/utils';
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  TREE_WIDTH,
  addDays,
  addWorkingDays,
  buildCalendar,
  buildDayAxis,
  type DayAxis,
  computeRange,
  countWorkingDays,
  diffDays,
  formatWorkDuration,
  isWorkingDay,
  parseDate,
  snapBackward,
  workingDayHops,
  startOfDay,
  toDateString,
} from './ganttUtils';
import { Badge } from '@/components/ui/Badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { QuickAddPanel } from '@/components/workitem/QuickAddPanel';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { levelStyle, levelLabel, outlineNumbers, siblingCompare } from '@/lib/levels';
import { GanttFilters } from './GanttFilters';
import {
  EMPTY_FILTER,
  ancestorIds,
  isFilterActive,
  matchedIds,
  type GanttFilterState,
} from './filterLogic';
import type { ProjectMember } from '@/types/db';

interface Props {
  projectId: string;
  workItems: WorkItem[];
  dependencies: Dependency[];
  workingDays: number[];
  nonWorkingDays: NonWorkingDay[];
  members: ProjectMember[];
  onSelect: (id: string) => void;
  onCreate: (id: string) => void;
  canEdit: boolean;
  selectedId?: string;
}

interface FlatRow {
  item: WorkItem;
  depth: number;
  hasChildren: boolean;
  dimmed: boolean;
}

type DragMode = 'move' | 'resize-left' | 'resize-right';
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  origStart: Date;
  origEnd: Date;
  previewStart: Date;
  previewEnd: Date;
}

const TREE_WIDTH_MIN = 220;
const TREE_WIDTH_MAX = 720;
const TREE_WIDTH_KEY = 'gantt.treeWidth';
// Horizontal drag distance (px) before a row drag is treated as a level change.
const LEVEL_DRAG_THRESHOLD = 24;

export function GanttView({ projectId, workItems, dependencies, workingDays, nonWorkingDays, members, onSelect, onCreate, canEdit, selectedId }: Props) {
  const reschedule = useRescheduleFrom();
  const create = useCreateWorkItem();
  const reorder = useReorderWorkItems();
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';
  const calendar = useMemo(() => buildCalendar(workingDays, nonWorkingDays), [workingDays, nonWorkingDays]);
  const range = useMemo(() => computeRange(workItems), [workItems]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return new Set(workItems.filter((w) => w.level < 2).map((w) => w.id));
  });

  const { user } = useAuth();
  const filterStorageKey = `gantt.filter.${projectId}`;
  const [filter, setFilterState] = useState<GanttFilterState>(() => {
    try {
      const raw = window.localStorage.getItem(filterStorageKey);
      if (raw) return { ...EMPTY_FILTER, ...JSON.parse(raw) } as GanttFilterState;
    } catch { /* ignore */ }
    return EMPTY_FILTER;
  });
  const setFilter = useCallback((f: GanttFilterState) => {
    setFilterState(f);
    try { window.localStorage.setItem(filterStorageKey, JSON.stringify(f)); } catch { /* ignore */ }
  }, [filterStorageKey]);

  const { visibleIds, dimmedIds } = useMemo(() => {
    if (!isFilterActive(filter)) {
      return { visibleIds: null as Set<string> | null, dimmedIds: new Set<string>() };
    }
    const matched = matchedIds({
      items: workItems,
      dependencies,
      filter,
      currentUserId: user?.id ?? null,
    });
    const ancestors = ancestorIds(workItems, matched);
    const visible = new Set<string>([...matched, ...ancestors]);
    return { visibleIds: visible, dimmedIds: ancestors };
  }, [filter, workItems, dependencies, user?.id]);

  // Auto-expand ancestors when filter shows them; otherwise user's expand state.
  useEffect(() => {
    if (!visibleIds) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of dimmedIds) next.add(id);
      return next;
    });
  }, [visibleIds, dimmedIds]);

  const flatRows = useMemo(
    () => flatten(workItems, expanded, visibleIds, dimmedIds),
    [workItems, expanded, visibleIds, dimmedIds],
  );
  const numbers = useMemo(() => outlineNumbers(workItems), [workItems]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [createDrag, setCreateDrag] = useState<{ id: string; anchor: Date; previewStart: Date; previewEnd: Date } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<{ id: string; pos: 'before' | 'after' | 'on' | 'indent' | 'outdent' } | null>(null);
  const dragStartX = useRef(0);

  const selectedItem = useMemo(
    () => (selectedId ? workItems.find((w) => w.id === selectedId) : undefined),
    [selectedId, workItems],
  );

  // A predecessor pins one edge of its successor, so that edge can't be dragged:
  // FS/SS pin the start, FF/SF pin the end. Move changes both edges, so any
  // predecessor disables it. Editing the relationship is done via the dep editor.
  const { startLocked, endLocked, hasPred } = useMemo(() => {
    const start = new Set<string>();
    const end = new Set<string>();
    const any = new Set<string>();
    for (const d of dependencies) {
      any.add(d.successor_id);
      if (d.type === 'FS' || d.type === 'SS') start.add(d.successor_id);
      else end.add(d.successor_id);
    }
    return { startLocked: start, endLocked: end, hasPred: any };
  }, [dependencies]);

  // Resizable tree column
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(TREE_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= TREE_WIDTH_MIN && n <= TREE_WIDTH_MAX ? n : TREE_WIDTH;
  });
  useEffect(() => {
    try { window.localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth)); } catch { /* ignore */ }
  }, [treeWidth]);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resizing) return;
    function onMove(e: PointerEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, e.clientX - rect.left));
      setTreeWidth(w);
    }
    function onUp() { setResizing(false); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const onLeftScroll = () => {
    if (syncingScrollRef.current) return;
    const r = scrollRef.current, l = leftScrollRef.current;
    if (!r || !l) return;
    syncingScrollRef.current = true;
    r.scrollTop = l.scrollTop;
    requestAnimationFrame(() => { syncingScrollRef.current = false; });
  };
  const onRightScroll = () => {
    if (syncingScrollRef.current) return;
    const r = scrollRef.current, l = leftScrollRef.current;
    if (!r || !l) return;
    syncingScrollRef.current = true;
    l.scrollTop = r.scrollTop;
    requestAnimationFrame(() => { syncingScrollRef.current = false; });
  };
  const today = startOfDay(new Date());

  const ZOOM_MIN = 2;
  const ZOOM_MAX = 280;
  const [dayWidth, setDayWidth] = useState(DAY_WIDTH);
  const dayWidthRef = useRef(dayWidth);
  useEffect(() => { dayWidthRef.current = dayWidth; }, [dayWidth]);

  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // View extends well past project bounds so user can scroll into empty months
  const PAD_DAYS_LEFT = 180;
  const PAD_DAYS_RIGHT = 365;
  const viewStart = useMemo(() => addDays(range.start, -PAD_DAYS_LEFT), [range.start]);
  const baseDays = range.days + PAD_DAYS_LEFT + PAD_DAYS_RIGHT;
  const effectiveDays = Math.max(baseDays, Math.ceil(viewportWidth / dayWidth));

  // Compressed off-day width: weekends/holidays take minimal horizontal space.
  const offWidth = Math.max(4, Math.round(dayWidth * 0.22));
  const axis = useMemo(
    () => buildDayAxis(viewStart, effectiveDays, dayWidth, offWidth, calendar),
    [viewStart, effectiveDays, dayWidth, offWidth, calendar],
  );
  const axisRef = useRef(axis);
  useEffect(() => { axisRef.current = axis; }, [axis]);

  // Center on today initially
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayX = axisRef.current.xOf(diffDays(today, viewStart));
    scrollRef.current.scrollLeft = Math.max(0, todayX - 200);
  }, [viewStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Day (with sub-day fraction) to re-pin under the cursor after a zoom; applied
  // in useLayoutEffect below so it lands before paint (no flash/clamp jump).
  const pendingZoom = useRef<{ dayIndex: number; frac: number; ax: number } | null>(null);

  function zoomAt(factor: number, anchorClientX?: number) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - rect.left : el.clientWidth / 2;
    const cur = dayWidthRef.current;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cur * factor));
    if (next === cur) return;
    // Map cursor pixel -> real day index via current (pre-zoom) axis, which is
    // non-linear because off-days are compressed to offWidth. Use axisRef (live)
    // since the wheel handler closes over a stale render of zoomAt.
    const cAxis = axisRef.current;
    const anchorPx = el.scrollLeft + ax;
    const dayIndex = cAxis.indexAtX(anchorPx);
    const frac = (anchorPx - cAxis.xOf(dayIndex)) / cAxis.widthOf(dayIndex);
    pendingZoom.current = { dayIndex, frac, ax };
    setDayWidth(next);
  }

  // Re-anchor after the new axis has rendered. Keyed on axis so it fires once the
  // post-zoom layout exists; runs synchronously before paint to avoid the jump.
  useLayoutEffect(() => {
    const p = pendingZoom.current;
    if (!p || !scrollRef.current) return;
    pendingZoom.current = null;
    const newAnchorPx = axis.xOf(p.dayIndex) + p.frac * axis.widthOf(p.dayIndex);
    scrollRef.current.scrollLeft = newAnchorPx - p.ax;
  }, [axis]);

  // Non-passive wheel listener: needed so preventDefault on ctrl/meta+wheel actually blocks browser zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAt(factor, e.clientX);
        return;
      }
      if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        el!.scrollLeft += e.deltaY;
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag handlers (bar move/resize). The edge a predecessor constrains is locked
  // at the source (startDrag), so no clamping is needed here.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const curIdx = clientXToIndex(e.clientX);
      const startIdx = clientXToIndex(drag!.startX);
      const deltaDays = curIdx != null && startIdx != null ? curIdx - startIdx : 0;
      let ns = drag!.origStart;
      let ne = drag!.origEnd;
      if (drag!.mode === 'move') {
        // Shift by working days so the bar jumps over weekends and keeps its work-day length.
        const hops =
          curIdx != null && startIdx != null
            ? workingDayHops(addDays(viewStart, startIdx), addDays(viewStart, curIdx), calendar)
            : 0;
        ns = addWorkingDays(drag!.origStart, hops, calendar);
        ne = addWorkingDays(drag!.origEnd, hops, calendar);
      } else if (drag!.mode === 'resize-left') {
        ns = snapBackward(addDays(drag!.origStart, deltaDays), calendar);
        if (ns > drag!.origEnd) ns = drag!.origEnd;
      } else if (drag!.mode === 'resize-right') {
        ne = snapBackward(addDays(drag!.origEnd, deltaDays), calendar);
        if (ne < drag!.origStart) ne = drag!.origStart;
      }
      setDrag({ ...drag!, previewStart: ns, previewEnd: ne });
    }
    function onUp() {
      const final = drag!;
      const changed =
        toDateString(final.previewStart) !== toDateString(final.origStart) ||
        toDateString(final.previewEnd) !== toDateString(final.origEnd);
      setDrag(null);
      if (!changed) return;
      reschedule.mutate(
        {
          project_id: projectId,
          work_item_id: final.id,
          new_start: toDateString(final.previewStart),
          new_end: toDateString(final.previewEnd),
        },
        { onError: (e) => toast.error((e as Error).message) },
      );
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, projectId, reschedule, calendar]);

  function clientXToIndex(clientX: number): number | null {
    const el = scrollRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = el.scrollLeft + (clientX - rect.left);
    return axisRef.current.indexAtX(x);
  }

  function clientXToDate(clientX: number): Date | null {
    const idx = clientXToIndex(clientX);
    if (idx == null) return null;
    return addDays(viewStart, idx);
  }

  // Create-by-drag on rows with no dates yet.
  useEffect(() => {
    if (!createDrag) return;
    function onMove(e: PointerEvent) {
      const d = clientXToDate(e.clientX);
      if (!d) return;
      setCreateDrag((s) => {
        if (!s) return s;
        const lo = d < s.anchor ? d : s.anchor;
        const hi = d < s.anchor ? s.anchor : d;
        return { ...s, previewStart: snapBackward(lo, calendar), previewEnd: snapBackward(hi, calendar) };
      });
    }
    function onUp() {
      const final = createDrag!;
      setCreateDrag(null);
      reschedule.mutate(
        {
          project_id: projectId,
          work_item_id: final.id,
          new_start: toDateString(final.previewStart),
          new_end: toDateString(final.previewEnd),
        },
        { onError: (e) => toast.error((e as Error).message) },
      );
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [createDrag, projectId, reschedule]); // eslint-disable-line react-hooks/exhaustive-deps

  function startCreateDrag(e: React.PointerEvent, row: FlatRow) {
    if (!canEdit) return;
    if (row.hasChildren) return;
    if (row.item.start_date && row.item.end_date) return;
    const d = clientXToDate(e.clientX);
    if (!d) return;
    e.preventDefault();
    setCreateDrag({ id: row.item.id, anchor: d, previewStart: d, previewEnd: d });
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(workItems.map((w) => w.id)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  async function addRoot() {
    try {
      const res = await create.mutateAsync({
        project_id: projectId,
        parent_id: null,
        name: t('workItem.newItem'),
      });
      onCreate(res.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addChild(parent: WorkItem) {
    try {
      // Parent dates/duration roll up from leaf children, so a child with null
      // dates would blank the parent (and orphan any gantt dependency lines).
      // Seed the new child with dates so the parent's bar is preserved.
      const siblings = workItems.filter((w) => w.parent_id === parent.id && !w.deleted_at);
      let start_date: string | null = null;
      let end_date: string | null = null;
      let duration_days: number | null = null;
      if (siblings.length === 0) {
        // First child: inherit the parent's span verbatim.
        start_date = parent.start_date;
        end_date = parent.end_date;
        duration_days = parent.duration_days;
      } else {
        // Later children: start the working day after the latest sibling ends,
        // 1-day default span (no overlap with siblings).
        const latestEnd = siblings.reduce<string | null>(
          (max, w) => (w.end_date && (!max || w.end_date > max) ? w.end_date : max),
          null,
        );
        const e = parseDate(latestEnd);
        if (e) {
          start_date = toDateString(addWorkingDays(e, 1, calendar));
          end_date = start_date;
        }
      }
      const r = await create.mutateAsync({
        project_id: projectId,
        parent_id: parent.id,
        name: t('workItem.newItem'),
        start_date,
        end_date,
        duration_days,
      });
      setExpanded((prev) => {
        const n = new Set(prev);
        n.add(parent.id);
        return n;
      });
      onCreate(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const del = useDeleteWorkItem();
  async function remove(item: WorkItem) {
    if (!confirm(t('workItem.deleteConfirm', { name: item.name }))) return;
    try {
      await del.mutateAsync({ id: item.id, project_id: projectId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Map: id -> all descendants (excluded as drop targets to prevent cycles).
  const descendants = useMemo(() => {
    const byParent = new Map<string | null, WorkItem[]>();
    for (const w of workItems) {
      const k = w.parent_id ?? null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(w);
    }
    function collect(id: string, out: Set<string>) {
      const list = byParent.get(id) ?? [];
      for (const c of list) {
        out.add(c.id);
        collect(c.id, out);
      }
    }
    const result = new Map<string, Set<string>>();
    for (const w of workItems) {
      const s = new Set<string>();
      collect(w.id, s);
      result.set(w.id, s);
    }
    return result;
  }, [workItems]);

  function isInvalidDropTarget(draggedId: string, targetId: string): boolean {
    if (draggedId === targetId) return true;
    const descs = descendants.get(draggedId);
    return descs ? descs.has(targetId) : false;
  }

  function onRowDragStart(e: React.DragEvent, id: string) {
    if (!canEdit) return;
    setDragRowId(id);
    dragStartX.current = e.clientX;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
  }
  function onRowDragOver(e: React.DragEvent, id: string) {
    if (!dragRowId) return;
    // Dragging over the row's own position: horizontal motion = change level (indent/outdent).
    if (id === dragRowId) {
      const dx = e.clientX - dragStartX.current;
      let pos: 'indent' | 'outdent' | null = null;
      if (dx > LEVEL_DRAG_THRESHOLD) pos = 'indent';
      else if (dx < -LEVEL_DRAG_THRESHOLD) pos = 'outdent';
      if (!pos) {
        if (overRow) setOverRow(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!overRow || overRow.id !== id || overRow.pos !== pos) setOverRow({ id, pos });
      return;
    }
    if (isInvalidDropTarget(dragRowId, id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let pos: 'before' | 'after' | 'on';
    if (y < h * 0.25) pos = 'before';
    else if (y > h * 0.75) pos = 'after';
    else pos = 'on';
    if (!overRow || overRow.id !== id || overRow.pos !== pos) {
      setOverRow({ id, pos });
    }
  }
  function clearRowDrag() {
    setDragRowId(null);
    setOverRow(null);
  }
  function onRowDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const draggedId = dragRowId;
    const over = overRow;
    clearRowDrag();
    if (!draggedId || !over) return;
    if (over.pos === 'indent') { indentItem(draggedId); return; }
    if (over.pos === 'outdent') { outdentItem(draggedId); return; }
    if (isInvalidDropTarget(draggedId, targetId)) return;

    const target = workItems.find((w) => w.id === targetId);
    if (!target) return;
    const newParentId = over.pos === 'on' ? targetId : (target.parent_id ?? null);

    const updates = computeReparentUpdates({
      items: workItems,
      draggedId,
      newParentId,
      targetId: over.pos === 'on' ? null : targetId,
      placeAfter: over.pos === 'after',
    });
    if (updates.length === 0) return;
    if (over.pos === 'on') {
      setExpanded((prev) => {
        const n = new Set(prev);
        n.add(targetId);
        return n;
      });
    }
    reorder.mutate(
      { project_id: projectId, updates },
      { onError: (err) => toast.error((err as Error).message) },
    );
  }

  const indentItem = useCallback((id: string) => {
    if (!canEdit) return;
    const item = workItems.find((w) => w.id === id);
    if (!item) return;
    const siblings = workItems
      .filter((w) => w.parent_id === item.parent_id && !w.deleted_at)
      .sort(siblingCompare);
    const idx = siblings.findIndex((w) => w.id === id);
    if (idx <= 0) return;
    const newParent = siblings[idx - 1];
    const updates = computeReparentUpdates({
      items: workItems,
      draggedId: id,
      newParentId: newParent.id,
      targetId: null,
      placeAfter: true,
    });
    if (updates.length === 0) return;
    setExpanded((prev) => {
      const n = new Set(prev);
      n.add(newParent.id);
      return n;
    });
    reorder.mutate(
      { project_id: projectId, updates },
      { onError: (err) => toast.error((err as Error).message) },
    );
  }, [canEdit, workItems, projectId, reorder]);

  const outdentItem = useCallback((id: string) => {
    if (!canEdit) return;
    const item = workItems.find((w) => w.id === id);
    if (!item || item.parent_id == null) return;
    const parent = workItems.find((w) => w.id === item.parent_id);
    if (!parent) return;
    const updates = computeReparentUpdates({
      items: workItems,
      draggedId: id,
      newParentId: parent.parent_id ?? null,
      targetId: parent.id,
      placeAfter: true,
    });
    if (updates.length === 0) return;
    reorder.mutate(
      { project_id: projectId, updates },
      { onError: (err) => toast.error((err as Error).message) },
    );
  }, [canEdit, workItems, projectId, reorder]);

  useEffect(() => {
    if (!selectedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tgt && tgt.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) outdentItem(selectedId!);
      else indentItem(selectedId!);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, indentItem, outdentItem]);

  function startDrag(e: React.PointerEvent, row: FlatRow, mode: DragMode) {
    if (!canEdit) return;
    if (row.hasChildren) return; // rollup parents are read-only
    const id = row.item.id;
    // A predecessor owns the pinned edge — block the drag that would move it.
    if (mode === 'move' && hasPred.has(id)) return;
    if (mode === 'resize-left' && startLocked.has(id)) return;
    if (mode === 'resize-right' && endLocked.has(id)) return;
    const s = parseDate(row.item.start_date);
    const en = parseDate(row.item.end_date);
    if (!s || !en) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      id: row.item.id,
      mode,
      startX: e.clientX,
      origStart: s,
      origEnd: en,
      previewStart: s,
      previewEnd: en,
    });
  }

  const totalWidth = axis.total;
  const totalHeight = HEADER_HEIGHT + flatRows.length * ROW_HEIGHT;

  function rowIndexById(id: string): number {
    return flatRows.findIndex((r) => r.item.id === id);
  }
  function barRect(row: FlatRow): { x: number; w: number } | null {
    const isDragging = drag?.id === row.item.id;
    const s = isDragging ? drag!.previewStart : parseDate(row.item.start_date);
    const en = isDragging ? drag!.previewEnd : parseDate(row.item.end_date);
    if (!s || !en) return null;
    const si = diffDays(s, viewStart);
    const ei = diffDays(en, viewStart);
    const x = axis.xOf(si);
    const w = axis.xOf(ei) + axis.widthOf(ei) - x;
    return { x, w };
  }

  const todayIdx = diffDays(today, viewStart);
  const todayX = axis.xOf(todayIdx);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-900">
      <div className="h-10 px-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs shrink-0">
        <GanttFilters
          filter={filter}
          setFilter={setFilter}
          members={members}
          workItems={workItems}
          currentUserId={user?.id ?? null}
        />
        <div className="flex-1" />
        <div className="flex items-center gap-1 mr-2">
          <button
            onClick={() => zoomAt(1 / 1.25)}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            disabled={dayWidth <= ZOOM_MIN}
            aria-label="Zoom out"
            title="Zoom out (Ctrl+wheel)"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setDayWidth(DAY_WIDTH)}
            className="px-1.5 h-6 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400"
            title="Reset zoom"
          >
            {Math.round((dayWidth / DAY_WIDTH) * 100)}%
          </button>
          <button
            onClick={() => zoomAt(1.25)}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            disabled={dayWidth >= ZOOM_MAX}
            aria-label="Zoom in"
            title="Zoom in (Ctrl+wheel)"
          >
            <ZoomIn size={14} />
          </button>
        </div>
        <div className="text-neutral-500 dark:text-neutral-400">{t('gantt.visibleTotal', { visible: flatRows.length, total: workItems.length })}</div>
      </div>
      <div ref={containerRef} className={cn('flex-1 overflow-hidden flex', resizing && 'select-none cursor-col-resize')}>
        {/* Tree column (left, fixed width, resizable) */}
        <div className="border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0 flex flex-col" style={{ width: treeWidth }}>
          <div
            className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1 px-3 shrink-0"
            style={{ height: HEADER_HEIGHT }}
          >
            <span>{t('gantt.workItem')}</span>
            <button
              onClick={expandAll}
              className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
              title={t('gantt.expandAll')}
              aria-label={t('gantt.expandAll')}
            >
              <ChevronsUpDown size={14} />
            </button>
            <button
              onClick={collapseAll}
              className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
              title={t('gantt.collapseAll')}
              aria-label={t('gantt.collapseAll')}
            >
              <ChevronsDownUp size={14} />
            </button>
            <div className="flex-1" />
            {canEdit && (
              <>
                <button
                  onClick={() => setQuickOpen((v) => !v)}
                  className={cn(
                    'p-1 rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800',
                    quickOpen && 'bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200',
                  )}
                  title={t('workItem.quickAdd')}
                  aria-label={t('workItem.quickAdd')}
                >
                  <ListPlus size={14} />
                </button>
                <button
                  onClick={addRoot}
                  disabled={create.isPending}
                  className="p-1 rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-40"
                  title={t('workItem.addRoot')}
                  aria-label={t('workItem.addRoot')}
                >
                  <Plus size={14} />
                </button>
              </>
            )}
          </div>
          {canEdit && quickOpen && (
            <div className="p-2 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
              <QuickAddPanel
                projectId={projectId}
                selected={selectedItem}
                onClose={() => setQuickOpen(false)}
                onLastCreated={(id) => onCreate(id)}
              />
            </div>
          )}
          <div ref={leftScrollRef} onScroll={onLeftScroll} className="flex-1 overflow-y-auto">
            {flatRows.length === 0 && (
              <div className="m-3 text-xs text-neutral-500 dark:text-neutral-400 py-8 text-center border border-dashed border-neutral-300 dark:border-neutral-700 rounded">
                {t('workItem.noItems')} {canEdit && t('workItem.addRootToStart')}
              </div>
            )}
            {flatRows.map((r) => {
              const s = parseDate(r.item.start_date);
              const en = parseDate(r.item.end_date);
              const wd = s && en ? countWorkingDays(s, en, calendar) : 0;
              const isSelected = selectedId === r.item.id;
              const rowDraggable = canEdit;
              const isDraggingThis = dragRowId === r.item.id;
              const isDropTarget = overRow?.id === r.item.id;
              const dropBefore = isDropTarget && overRow!.pos === 'before';
              const dropAfter = isDropTarget && overRow!.pos === 'after';
              const dropOn = isDropTarget && overRow!.pos === 'on';
              const dropIndent = isDropTarget && overRow!.pos === 'indent';
              const dropOutdent = isDropTarget && overRow!.pos === 'outdent';
              const num = numbers.get(r.item.id) ?? '';
              return (
                <div
                  key={r.item.id}
                  data-keep-drawer
                  onClick={() => onSelect(r.item.id)}
                  draggable={rowDraggable}
                  onDragStart={rowDraggable ? (e) => onRowDragStart(e, r.item.id) : undefined}
                  onDragOver={(e) => onRowDragOver(e, r.item.id)}
                  onDrop={(e) => onRowDrop(e, r.item.id)}
                  onDragEnd={rowDraggable ? clearRowDrag : undefined}
                  className={cn(
                    'group flex items-center gap-1 px-2 cursor-pointer border-b border-neutral-100 dark:border-neutral-800',
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/40'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800',
                    isDraggingThis && 'opacity-40',
                    r.dimmed && 'opacity-50',
                    dropBefore && 'shadow-[inset_0_2px_0_0_#3b82f6]',
                    dropAfter && 'shadow-[inset_0_-2px_0_0_#3b82f6]',
                    dropOn && 'ring-2 ring-inset ring-blue-400',
                    dropIndent && 'shadow-[inset_3px_0_0_0_#3b82f6] ring-1 ring-inset ring-blue-400',
                    dropOutdent && 'shadow-[inset_-3px_0_0_0_#3b82f6] ring-1 ring-inset ring-blue-400',
                  )}
                  style={{ height: ROW_HEIGHT, paddingLeft: 8 + Math.max(0, r.depth + (dropIndent ? 1 : dropOutdent ? -1 : 0)) * 14 }}
                  title={canEdit ? t('workItem.dragHint') : undefined}
                >
                  <button
                    className={cn('p-0.5 text-neutral-400 dark:text-neutral-500', !r.hasChildren && 'invisible')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(r.item.id);
                    }}
                  >
                    {expanded.has(r.item.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <Badge kind={r.item.level}>{levelLabel(r.item.level)}</Badge>
                  <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0">{num}</span>
                  <span className="text-xs truncate flex-1">{r.item.name}</span>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-7 text-right tabular-nums group-hover:hidden">{formatWorkDuration(wd)}</span>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-7 text-right tabular-nums group-hover:hidden">{r.item.progress}%</span>
                  {canEdit && (
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); addChild(r.item); }}
                        className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-500 dark:text-neutral-400"
                        title={t('workItem.addChild')}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(r.item); }}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-950 rounded text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                        title={t('common.delete')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Resize handle */}
        <div
          onPointerDown={(e) => { e.preventDefault(); setResizing(true); }}
          className={cn(
            'w-1 shrink-0 cursor-col-resize relative group',
            resizing ? 'bg-blue-400' : 'hover:bg-blue-400/60',
          )}
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Timeline column (right, scrollable) */}
        <div ref={scrollRef} onScroll={onRightScroll} className="flex-1 overflow-auto relative">
          <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
            {/* Header: month + day strip */}
            <TimelineHeader viewStart={viewStart} days={effectiveDays} axis={axis} todayX={todayX} calendar={calendar} locale={locale} />

            {/* Weekend & today background overlay */}
            <div
              className="absolute left-0 pointer-events-none"
              style={{ top: HEADER_HEIGHT, width: totalWidth, height: totalHeight - HEADER_HEIGHT }}
            >
              {Array.from({ length: effectiveDays }, (_, i) => {
                const d = addDays(viewStart, i);
                if (isWorkingDay(d, calendar)) return null;
                const isHoliday = calendar.nonWorking.has(toDateString(d));
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute top-0 bottom-0',
                      isHoliday
                        ? 'bg-amber-100 dark:bg-amber-900/30'
                        : 'bg-neutral-100 dark:bg-neutral-800/50',
                    )}
                    style={{ left: axis.xOf(i), width: axis.widthOf(i) }}
                  />
                );
              })}
              {/* Today line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-red-400"
                  style={{ left: todayX + axis.widthOf(todayIdx) / 2 }}
                />
              )}
            </div>

            {/* Rows */}
            <div className="absolute left-0" style={{ top: HEADER_HEIGHT, width: totalWidth }}>
              {flatRows.map((r) => {
                const rect = barRect(r);
                const isRollup = r.hasChildren;
                const moveLocked = hasPred.has(r.item.id);
                const sLocked = startLocked.has(r.item.id);
                const eLocked = endLocked.has(r.item.id);
                const canCreate =
                  canEdit && !isRollup && !(r.item.start_date && r.item.end_date);
                const style = levelStyle(r.item.level);
                const creating = createDrag?.id === r.item.id;
                const createRect = creating
                  ? (() => {
                      const si = diffDays(createDrag!.previewStart, viewStart);
                      const ei = diffDays(createDrag!.previewEnd, viewStart);
                      const x = axis.xOf(si);
                      return { x, w: axis.xOf(ei) + axis.widthOf(ei) - x };
                    })()
                  : null;
                return (
                  <div
                    key={r.item.id}
                    className={cn(
                      'relative border-b border-neutral-100 dark:border-neutral-800',
                      canCreate && !rect && 'cursor-crosshair',
                      r.dimmed && 'opacity-50',
                    )}
                    style={{ height: ROW_HEIGHT }}
                    onPointerDown={canCreate ? (e) => startCreateDrag(e, r) : undefined}
                  >
                    {createRect && (
                      <div
                        className="absolute top-1 rounded bg-blue-400/70 border border-blue-600 pointer-events-none"
                        style={{
                          left: createRect.x,
                          width: Math.max(createRect.w, 4),
                          height: ROW_HEIGHT - 8,
                        }}
                      />
                    )}
                    {rect && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            data-keep-drawer
                            className={cn(
                              'absolute top-1 rounded text-[10px] text-white flex items-center justify-center select-none',
                              isRollup
                                ? 'bg-neutral-700 dark:bg-neutral-600 cursor-default'
                                : cn(style.bar, moveLocked ? 'cursor-default' : 'cursor-move'),
                              drag?.id === r.item.id && 'ring-2 ring-blue-300',
                            )}
                            style={{
                              left: rect.x,
                              width: Math.max(rect.w, 12),
                              height: ROW_HEIGHT - 8,
                            }}
                            onPointerDown={(e) => startDrag(e, r, 'move')}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect(r.item.id);
                            }}
                          >
                            {/* progress fill */}
                            <div
                              className={cn(
                                'absolute left-0 top-0 bottom-0 rounded-l',
                                isRollup ? 'bg-neutral-900/40' : style.barProgress,
                              )}
                              style={{ width: `${r.item.progress}%` }}
                            />
                            <span className="relative px-1 truncate pointer-events-none">
                              <span className="opacity-70 tabular-nums mr-1">{numbers.get(r.item.id) ?? ''}</span>
                              {r.item.name}
                            </span>

                            {!isRollup && canEdit && (
                              <>
                                {!sLocked && (
                                  <div
                                    className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                    onPointerDown={(e) => startDrag(e, r, 'resize-left')}
                                  />
                                )}
                                {!eLocked && (
                                  <div
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                    onPointerDown={(e) => startDrag(e, r, 'resize-right')}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">{r.item.name}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Dependency arrows */}
            <svg
              className="absolute pointer-events-none"
              style={{
                top: HEADER_HEIGHT,
                left: 0,
                width: totalWidth,
                height: flatRows.length * ROW_HEIGHT,
              }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <polygon points="0 0, 6 3, 0 6" fill="#94a3b8" />
                </marker>
              </defs>
              {dependencies.map((dep) => {
                const pi = rowIndexById(dep.predecessor_id);
                const si = rowIndexById(dep.successor_id);
                if (pi < 0 || si < 0) return null;
                const pRow = flatRows[pi];
                const sRow = flatRows[si];
                const pRect = barRect(pRow);
                const sRect = barRect(sRow);
                if (!pRect || !sRect) return null;
                const pY = pi * ROW_HEIGHT + ROW_HEIGHT / 2;
                const sY = si * ROW_HEIGHT + ROW_HEIGHT / 2;
                let x1: number, x2: number;
                if (dep.type === 'FS') { x1 = pRect.x + pRect.w; x2 = sRect.x; }
                else if (dep.type === 'FF') { x1 = pRect.x + pRect.w; x2 = sRect.x + sRect.w; }
                else if (dep.type === 'SS') { x1 = pRect.x; x2 = sRect.x; }
                else { x1 = pRect.x; x2 = sRect.x + sRect.w; }
                const midX = (x1 + x2) / 2;
                const path = `M ${x1} ${pY} L ${midX} ${pY} L ${midX} ${sY} L ${x2} ${sY}`;
                return (
                  <path
                    key={dep.id}
                    d={path}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    markerEnd="url(#arrowhead)"
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineHeader({ viewStart, days, axis, todayX, calendar, locale }: { viewStart: Date; days: number; axis: DayAxis; todayX: number; calendar: import('./ganttUtils').WorkCalendar; locale: string }) {
  const dayWidth = axis.dayWidth;
  const months: { label: string; x: number; width: number }[] = [];
  let curMonthKey = '';
  let curStart = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(viewStart, i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== curMonthKey) {
      if (curMonthKey) {
        months.push({
          label: monthLabel(addDays(viewStart, curStart), locale),
          x: axis.xOf(curStart),
          width: axis.xOf(i) - axis.xOf(curStart),
        });
      }
      curMonthKey = key;
      curStart = i;
    }
  }
  months.push({
    label: monthLabel(addDays(viewStart, curStart), locale),
    x: axis.xOf(curStart),
    width: axis.xOf(days) - axis.xOf(curStart),
  });

  const showDayNumbers = dayWidth >= 18;

  return (
    <div
      className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
      style={{ height: HEADER_HEIGHT, width: axis.total }}
    >
      <div className="relative border-b border-neutral-200 dark:border-neutral-800" style={{ height: HEADER_HEIGHT / 2 }}>
        {months.map((m, idx) => (
          <div
            key={idx}
            className="absolute top-0 bottom-0 px-2 flex items-center text-[11px] font-medium text-neutral-700 dark:text-neutral-200 border-r border-neutral-200 dark:border-neutral-800"
            style={{ left: m.x, width: m.width }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="relative" style={{ height: HEADER_HEIGHT / 2 }}>
        {Array.from({ length: days }, (_, i) => {
          const d = addDays(viewStart, i);
          const offDay = !isWorkingDay(d, calendar);
          const isHoliday = calendar.nonWorking.has(toDateString(d));
          const isToday = axis.xOf(i) === todayX;
          return (
            <div
              key={i}
              className={cn(
                'absolute top-0 bottom-0 flex items-center justify-center text-[10px] border-r border-neutral-100 dark:border-neutral-800',
                offDay && !isHoliday && 'text-neutral-400 dark:text-neutral-500',
                isHoliday && 'text-amber-600 dark:text-amber-400',
                isToday && 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold',
              )}
              style={{ left: axis.xOf(i), width: axis.widthOf(i) }}
            >
              {showDayNumbers && !offDay ? d.getDate() : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function monthLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}

function flatten(
  items: WorkItem[],
  expanded: Set<string>,
  visibleIds: Set<string> | null,
  dimmedIds: Set<string>,
): FlatRow[] {
  const byParent = new Map<string | null, WorkItem[]>();
  for (const it of items) {
    if (it.deleted_at) continue;
    if (visibleIds && !visibleIds.has(it.id)) continue;
    const k = it.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  }
  for (const arr of byParent.values()) arr.sort(siblingCompare);
  const out: FlatRow[] = [];
  function walk(parent: string | null, depth: number) {
    const list = byParent.get(parent) ?? [];
    for (const it of list) {
      const children = byParent.get(it.id) ?? [];
      out.push({
        item: it,
        depth,
        hasChildren: children.length > 0,
        dimmed: dimmedIds.has(it.id),
      });
      if (children.length > 0 && expanded.has(it.id)) {
        walk(it.id, depth + 1);
      }
    }
  }
  walk(null, 0);
  return out;
}

// Compute position updates to move `draggedId` into `newParentId`, placed
// next to `targetId` (or at end when null). placeAfter: true => after target.
function computeReparentUpdates({
  items,
  draggedId,
  newParentId,
  targetId,
  placeAfter,
}: {
  items: WorkItem[];
  draggedId: string;
  newParentId: string | null;
  targetId: string | null;
  placeAfter: boolean;
}): ReorderUpdate[] {
  const dragged = items.find((w) => w.id === draggedId);
  if (!dragged) return [];
  const sameParent = (dragged.parent_id ?? null) === newParentId;

  const siblings = items
    .filter((w) => (w.parent_id ?? null) === newParentId && !w.deleted_at && w.id !== draggedId)
    .sort(siblingCompare);

  let insertIdx: number;
  if (targetId == null) {
    insertIdx = siblings.length;
  } else {
    const ti = siblings.findIndex((w) => w.id === targetId);
    insertIdx = ti < 0 ? siblings.length : (placeAfter ? ti + 1 : ti);
  }

  const next = [...siblings];
  next.splice(insertIdx, 0, dragged);

  const updates: ReorderUpdate[] = [];
  next.forEach((w, i) => {
    const newPos = (i + 1) * 1000;
    const parentChange = w.id === draggedId && !sameParent;
    if (w.position !== newPos || parentChange) {
      const u: ReorderUpdate = { id: w.id, position: newPos };
      if (parentChange) u.parent_id = newParentId;
      updates.push(u);
    }
  });
  return updates;
}
