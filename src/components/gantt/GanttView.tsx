import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { CalendarCheck, ChevronDown, ChevronRight, ZoomIn, ZoomOut, Plus, Trash2, ListPlus, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import type { Dependency, NonWorkingDay, WorkItem } from '@/types/db';
import { useCreateWorkItem, useDeleteWorkItem, useReorderWorkItems, useRescheduleFrom, useSetPlannedRange } from '@/hooks/useWorkItems';
import { hasPlannedRange } from '@/lib/plannedRange';
import { ancestorChain, computeReparentUpdates } from '@/lib/workItemTree';
import { cn, formatDate } from '@/lib/utils';
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
import { computeSuccessorBinding } from '@/lib/cascade';
import { Badge } from '@/components/ui/Badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { QuickAddPanel } from '@/components/workitem/QuickAddPanel';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { levelLabel, outlineNumbers, siblingCompare, statusOf, statusStyle } from '@/lib/levels';
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
  // Has visible children (drives the expand chevron; a filter can hide them all).
  hasChildren: boolean;
  // Has live children at all (drives bar style and what may be dragged).
  isParent: boolean;
  dimmed: boolean;
}

// leaf: its own dates. committed: a parent with a committed range (the bar is
// that range, resizable at both ends). fit: a parent that fits its sub-tasks.
type BarKind = 'leaf' | 'committed' | 'fit';

// Hatched fuchsia for the stretch of a committed parent that sub-tasks push
// outside its range. Fuchsia because amber/red/blue/green are status colours.
const OVERFLOW_BG = 'repeating-linear-gradient(135deg, rgba(192, 38, 211, 0.55) 0 3px, rgba(192, 38, 211, 0.12) 3px 6px)';
const OVERFLOW_BORDER = '#C026D3';

type DragMode = 'move' | 'resize-left' | 'resize-right';
interface DragState {
  id: string;
  mode: DragMode;
  // 'planned' = resizing a committed parent's range rather than an item's dates.
  target: 'dates' | 'planned';
  startX: number;
  origStart: Date;
  origEnd: Date;
  previewStart: Date;
  previewEnd: Date;
  // ASAP binding: earliest legal start/end for this item from its incoming deps.
  // Computed once at drag start (preds don't move during drag). Null = unconstrained.
  startBinding: Date | null;
  endBinding: Date | null;
}

const TREE_WIDTH_MIN = 220;
const TREE_WIDTH_MAX = 720;
const TREE_WIDTH_KEY = 'gantt.treeWidth';
// Horizontal drag distance (px) before a row drag is treated as a level change.
const LEVEL_DRAG_THRESHOLD = 24;

export function GanttView({ projectId, workItems, dependencies, workingDays, nonWorkingDays, members, onSelect, onCreate, canEdit, selectedId }: Props) {
  const reschedule = useRescheduleFrom();
  const setRange = useSetPlannedRange();
  const create = useCreateWorkItem();
  const reorder = useReorderWorkItems();
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';
  const calendar = useMemo(() => buildCalendar(workingDays, nonWorkingDays), [workingDays, nonWorkingDays]);
  const range = useMemo(() => computeRange(workItems), [workItems]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return new Set(workItems.map((w) => w.id));
  });
  // Items load async; expand any that arrive after mount until user toggles manually.
  const expandedInitRef = useRef(false);
  useEffect(() => {
    if (expandedInitRef.current) return;
    if (workItems.length === 0) return;
    expandedInitRef.current = true;
    setExpanded(new Set(workItems.map((w) => w.id)));
  }, [workItems]);

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
  const itemById = useMemo(() => new Map(workItems.map((w) => [w.id, w])), [workItems]);
  // Span of each parent's live children, for previewing a committed-range drag.
  const childSpan = useMemo(() => {
    const out = new Map<string, { start: string | null; end: string | null }>();
    for (const w of workItems) {
      if (!w.parent_id || w.deleted_at) continue;
      const cur = out.get(w.parent_id) ?? { start: null, end: null };
      if (w.start_date && (!cur.start || w.start_date < cur.start)) cur.start = w.start_date;
      if (w.end_date && (!cur.end || w.end_date > cur.end)) cur.end = w.end_date;
      out.set(w.parent_id, cur);
    }
    return out;
  }, [workItems]);
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

  // Inequality model: deps are ASAP constraints, not pinned edges. Nothing is
  // un-draggable. Drag math clamps the bar at its bindings (see onMove below).

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
  // The tree and the timeline mirror each other's vertical scroll. Writing one
  // fires a scroll event on it, and that echo must not be written back: during
  // a smooth scroll it arrives a frame late, carrying an old position, and
  // writing it would cancel the animation and leave the chart part-way. So each
  // pane remembers the position it was last given and ignores an event that
  // just reports it. (A one-frame "syncing" flag can't do this: a smooth
  // scroll spans many frames.)
  const echoTopRef = useRef<{ left: number | null; right: number | null }>({ left: null, right: null });
  const onLeftScroll = () => {
    const r = scrollRef.current, l = leftScrollRef.current;
    if (!r || !l) return;
    if (l.scrollTop === echoTopRef.current.left || l.scrollTop === r.scrollTop) return;
    r.scrollTop = l.scrollTop;
    echoTopRef.current.right = r.scrollTop;
  };
  const onRightScroll = () => {
    const r = scrollRef.current, l = leftScrollRef.current;
    if (!r || !l) return;
    if (r.scrollTop === echoTopRef.current.right || r.scrollTop === l.scrollTop) return;
    l.scrollTop = r.scrollTop;
    echoTopRef.current.left = l.scrollTop;
  };
  const today = startOfDay(new Date());

  const ZOOM_MIN = 1;
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
  // Floor 2 (not 4) so 4yr+ projects can fit-to-viewport at low zoom.
  const offWidth = Math.max(2, Math.round(dayWidth * 0.22));
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

  // Fit-to-project on first open: pick dayWidth so the full project span fits
  // viewport, then scroll to project start. Runs once viewport+items ready.
  const fitInitRef = useRef(false);
  const pendingFitScroll = useRef<{ dayIndex: number } | null>(null);
  useEffect(() => {
    if (fitInitRef.current) return;
    if (viewportWidth === 0 || workItems.length === 0) return;
    fitInitRef.current = true;
    let work = 0, off = 0;
    for (let i = 0; i < range.days; i++) {
      if (isWorkingDay(addDays(range.start, i), calendar)) work++;
      else off++;
    }
    const target = viewportWidth * 0.92;
    // Binary search: largest dayWidth where work*dw + off*max(2, round(dw*0.22)) <= target.
    let lo = ZOOM_MIN, hi = ZOOM_MAX;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      const ow = Math.max(2, Math.round(mid * 0.22));
      const t = work * mid + off * ow;
      if (t <= target) lo = mid; else hi = mid;
    }
    const dw = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, lo));
    const dayIndex = diffDays(range.start, viewStart);
    if (dw === dayWidthRef.current) {
      // No zoom change means no new axis to wait for; a pending scroll would
      // never be applied (and centring on a selection waits for it).
      if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, axisRef.current.xOf(dayIndex) - 40);
      return;
    }
    pendingFitScroll.current = { dayIndex };
    setDayWidth(dw);
  }, [viewportWidth, workItems.length, range.days, range.start, calendar, viewStart]);

  // Apply pending fit-scroll after the new axis is laid out (overrides today-center).
  useLayoutEffect(() => {
    const p = pendingFitScroll.current;
    if (!p || !scrollRef.current) return;
    pendingFitScroll.current = null;
    scrollRef.current.scrollLeft = Math.max(0, axis.xOf(p.dayIndex) - 40);
  }, [axis]);

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

  // Selecting an item (a bar, a tree row, a search match, the drawer's
  // breadcrumb, a link from another page) scrolls the timeline sideways so its
  // bar sits in the middle of what is visible beside the item drawer.
  //
  // centerTargetRef names the item to centre explicitly. It is acted on only
  // once that item IS the selection: the selection arrives through the router
  // a render after the click, and the drawer mounts in that same render. Going
  // by "whatever is selected" at click time centred the previous item first,
  // and without the drawer on screen, so the chart jumped about.
  const centerTargetRef = useRef<string | null>(null);
  // The selection this view last acted on, so one made elsewhere is noticed.
  const seenSelectionRef = useRef<string | undefined>(undefined);
  // Re-clicking the already-selected item changes no prop; this re-runs the effect.
  const [centerTick, setCenterTick] = useState(0);
  // When a bar drag ended: the click that follows the drop must not scroll the
  // chart out from under the bar that was just moved.
  const dragEndedAtRef = useRef(0);
  function selectAndCenter(id: string) {
    centerTargetRef.current = id;
    seenSelectionRef.current = id;
    setCenterTick((n) => n + 1);
    onSelect(id);
  }
  function selectWithoutCentering(id: string) {
    centerTargetRef.current = null;
    seenSelectionRef.current = id;
    onSelect(id);
  }
  useEffect(() => {
    if (selectedId !== seenSelectionRef.current) {
      seenSelectionRef.current = selectedId;
      centerTargetRef.current = selectedId ?? null;
    }
    const target = centerTargetRef.current;
    if (!target || target !== selectedId) return;
    const el = scrollRef.current;
    // Wait for the first fit-to-project scroll, or it would override this one.
    // The effect re-runs as those settle (axis, viewportWidth), target intact.
    if (!el || viewportWidth === 0 || !fitInitRef.current || pendingFitScroll.current) return;
    const idx = flatRows.findIndex((r) => r.item.id === target);
    if (idx < 0) {
      // Under a collapsed parent: open its ancestors and come back next render.
      const item = itemById.get(target);
      const closed = item ? ancestorChain(itemById, item).filter((a) => !expanded.has(a.id)) : [];
      if (closed.length > 0) {
        setExpanded((prev) => new Set([...prev, ...closed.map((a) => a.id)]));
      } else {
        centerTargetRef.current = null; // filtered out: nothing to scroll to
      }
      return;
    }
    centerTargetRef.current = null;

    // Horizontal only: the vertical position is left where it is.
    const d = effectiveDates(flatRows[idx]);
    if (!d) return;
    // The drawer is a fixed panel over the right of the screen; centre in the
    // part of the timeline still visible beside it.
    const box = el.getBoundingClientRect();
    const panel = document.querySelector('[data-drawer-panel]')?.getBoundingClientRect();
    const visibleRight = panel ? Math.min(box.right, panel.left) : box.right;
    const visibleW = Math.max(200, visibleRight - box.left);
    const rect = rectOf(d.s, d.e);
    // A bar wider than the visible part starts near its left edge instead.
    const left = rect.w > visibleW - 80 ? rect.x - 40 : rect.x + rect.w / 2 - visibleW / 2;
    el.scrollTo({ left: Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth)), behavior: 'smooth' });
  }, [selectedId, centerTick, flatRows, axis, viewportWidth, expanded, itemById]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter in the search box: select (and so centre) the first matching row.
  function jumpToFirstMatch() {
    const first = flatRows.find((r) => !r.dimmed);
    if (first) selectAndCenter(first.item.id);
  }

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

  // Drag handlers (bar move/resize). Deps are ASAP inequalities; the bar is
  // clamped at its startBinding/endBinding (snapshotted at drag-start). Dragging
  // away from the binding is always free; dragging toward it hits the wall.
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
        let hops =
          curIdx != null && startIdx != null
            ? workingDayHops(addDays(viewStart, startIdx), addDays(viewStart, curIdx), calendar)
            : 0;
        // Minimum allowed shift: enough to keep both edges at-or-past their bindings.
        let minHops = -Infinity;
        if (drag!.startBinding) {
          minHops = Math.max(minHops, workingDayHops(drag!.origStart, drag!.startBinding, calendar));
        }
        if (drag!.endBinding) {
          minHops = Math.max(minHops, workingDayHops(drag!.origEnd, drag!.endBinding, calendar));
        }
        if (minHops > -Infinity && hops < minHops) hops = minHops;
        ns = addWorkingDays(drag!.origStart, hops, calendar);
        ne = addWorkingDays(drag!.origEnd, hops, calendar);
      } else if (drag!.mode === 'resize-left') {
        ns = snapBackward(addDays(drag!.origStart, deltaDays), calendar);
        if (drag!.startBinding && ns < drag!.startBinding) ns = drag!.startBinding;
        if (ns > drag!.origEnd) ns = drag!.origEnd;
      } else if (drag!.mode === 'resize-right') {
        ne = snapBackward(addDays(drag!.origEnd, deltaDays), calendar);
        if (drag!.endBinding && ne < drag!.endBinding) ne = drag!.endBinding;
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
      dragEndedAtRef.current = Date.now();
      const onError = (e: Error) => toast.error(e.message);
      if (final.target === 'planned') {
        setRange.mutate(
          {
            project_id: projectId,
            work_item_id: final.id,
            planned_start: toDateString(final.previewStart),
            planned_end: toDateString(final.previewEnd),
          },
          { onError },
        );
        return;
      }
      reschedule.mutate(
        {
          project_id: projectId,
          work_item_id: final.id,
          new_start: toDateString(final.previewStart),
          new_end: toDateString(final.previewEnd),
        },
        { onError },
      );
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, projectId, reschedule, setRange, calendar]);

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
    if (row.isParent) return;
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
    // Parents: only a committed range resizes (its ends); a fit parent and the
    // body of a committed one stay put — moving them wouldn't move sub-tasks.
    const kind = barKind(row);
    if (kind === 'fit' || (kind === 'committed' && mode === 'move')) return;
    const planned = kind === 'committed';
    const s = parseDate(planned ? row.item.planned_start : row.item.start_date);
    const en = parseDate(planned ? row.item.planned_end : row.item.end_date);
    if (!s || !en) return;
    // Snapshot the ASAP bindings now; preds don't move during the drag, so
    // recomputing per pointermove would be wasted work.
    const { startBinding, endBinding } = computeSuccessorBinding({
      successorId: row.item.id,
      items: workItems,
      dependencies,
      calendar,
    });
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      id: row.item.id,
      mode,
      target: planned ? 'planned' : 'dates',
      startX: e.clientX,
      origStart: s,
      origEnd: en,
      previewStart: s,
      previewEnd: en,
      startBinding,
      endBinding,
    });
  }

  const totalWidth = axis.total;
  const totalHeight = HEADER_HEIGHT + flatRows.length * ROW_HEIGHT;

  function rowIndexById(id: string): number {
    return flatRows.findIndex((r) => r.item.id === id);
  }
  function barKind(row: FlatRow): BarKind {
    if (!row.isParent) return 'leaf';
    return hasPlannedRange(row.item) ? 'committed' : 'fit';
  }

  // Committed range of an item, as the drag preview while it is being resized.
  function plannedOf(item: WorkItem): { s: Date; e: Date } | null {
    if (drag?.id === item.id && drag.target === 'planned') return { s: drag.previewStart, e: drag.previewEnd };
    const s = parseDate(item.planned_start);
    const e = parseDate(item.planned_end);
    return s && e ? { s, e } : null;
  }

  // Dates the bar covers: the drag preview for a leaf, the envelope of the
  // previewed range and the sub-tasks while a committed range is resized,
  // otherwise the stored (effective) dates.
  function effectiveDates(row: FlatRow): { s: Date; e: Date } | null {
    if (drag?.id === row.item.id) {
      if (drag.target === 'dates') return { s: drag.previewStart, e: drag.previewEnd };
      const span = childSpan.get(row.item.id);
      const kidS = parseDate(span?.start ?? null);
      const kidE = parseDate(span?.end ?? null);
      return {
        s: kidS && kidS < drag.previewStart ? kidS : drag.previewStart,
        e: kidE && kidE > drag.previewEnd ? kidE : drag.previewEnd,
      };
    }
    const s = parseDate(row.item.start_date);
    const e = parseDate(row.item.end_date);
    return s && e ? { s, e } : null;
  }

  function rectOf(s: Date, en: Date): { x: number; w: number } {
    const si = diffDays(s, viewStart);
    const ei = diffDays(en, viewStart);
    const x = axis.xOf(si);
    const w = axis.xOf(ei) + axis.widthOf(ei) - x;
    return { x, w };
  }

  function barRect(row: FlatRow): { x: number; w: number } | null {
    const d = effectiveDates(row);
    return d ? rectOf(d.s, d.e) : null;
  }

  const todayIdx = diffDays(today, viewStart);
  const todayX = axis.xOf(todayIdx);
  const todayIso = toDateString(today);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-900">
      <div className="h-10 px-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs shrink-0">
        <GanttFilters
          filter={filter}
          setFilter={setFilter}
          members={members}
          workItems={workItems}
          currentUserId={user?.id ?? null}
          onSubmitSearch={jumpToFirstMatch}
        />
        <div className="flex-1" />
        <BarLegend />
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
              const rowStatusStyle = statusStyle(statusOf(r.item, todayIso));
              return (
                <div
                  key={r.item.id}
                  data-keep-drawer
                  onClick={() => selectAndCenter(r.item.id)}
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
                  <Badge className={cn(rowStatusStyle.bar, rowStatusStyle.text)}>{levelLabel(r.item.level)}</Badge>
                  <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0">{num}</span>
                  {r.isParent && hasPlannedRange(r.item) && (
                    <CalendarCheck
                      size={11}
                      className="shrink-0 text-neutral-500 dark:text-neutral-400"
                      aria-label={t('workItem.committedParent')}
                    />
                  )}
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
                const kind = barKind(r);
                const eff = effectiveDates(r);
                const rect = eff ? rectOf(eff.s, eff.e) : null;
                const planned = kind === 'committed' ? plannedOf(r.item) : null;
                const plannedRect = planned ? rectOf(planned.s, planned.e) : null;
                const canCreate =
                  canEdit && kind === 'leaf' && !(r.item.start_date && r.item.end_date);
                const status = statusOf(r.item, todayIso);
                const sStyle = statusStyle(status);
                const isDragging = drag?.id === r.item.id;
                const label = (
                  <>
                    <span className="opacity-70 tabular-nums mr-1">{numbers.get(r.item.id) ?? ''}</span>
                    {r.item.name}
                  </>
                );
                // Outside the parent's committed range (the parent may be mid-resize).
                const parent = r.item.parent_id ? itemById.get(r.item.parent_id) : undefined;
                const parentPlanned = parent && hasPlannedRange(parent) ? plannedOf(parent) : null;
                const outsideBefore = !!eff && !!parentPlanned && eff.s < parentPlanned.s;
                const outsideAfter = !!eff && !!parentPlanned && eff.e > parentPlanned.e;
                const outsideDots = (
                  <>
                    {outsideBefore && (
                      <span
                        className="absolute -left-1 -top-1 w-2 h-2 rounded-full ring-1 ring-white dark:ring-neutral-900 pointer-events-none"
                        style={{ backgroundColor: OVERFLOW_BORDER }}
                      />
                    )}
                    {outsideAfter && (
                      <span
                        className="absolute -right-1 -top-1 w-2 h-2 rounded-full ring-1 ring-white dark:ring-neutral-900 pointer-events-none"
                        style={{ backgroundColor: OVERFLOW_BORDER }}
                      />
                    )}
                  </>
                );
                const outsideNote = (outsideBefore || outsideAfter) && (
                  <div className="opacity-80">{t('workItem.outsideParentRange')}</div>
                );
                const select = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  // The click that ends a drag only selects; any other click centres.
                  if (Date.now() - dragEndedAtRef.current < 400) {
                    selectWithoutCentering(r.item.id);
                  } else {
                    selectAndCenter(r.item.id);
                  }
                };
                const isSelected = selectedId === r.item.id;
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
                      isSelected && 'bg-blue-50/70 dark:bg-blue-950/30',
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

                    {/* Leaf: its own dates, movable and resizable. */}
                    {rect && kind === 'leaf' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            data-keep-drawer
                            className={cn(
                              'absolute top-1 rounded text-[10px] flex items-center justify-center select-none cursor-move',
                              sStyle.bar,
                              sStyle.text,
                              isDragging && 'ring-2 ring-blue-300',
                            )}
                            style={{
                              left: rect.x,
                              width: Math.max(rect.w, 12),
                              height: ROW_HEIGHT - 8,
                            }}
                            onPointerDown={(e) => startDrag(e, r, 'move')}
                            onClick={select}
                          >
                            {/* progress fill — lighter shade overlay; hidden when status is 'done' (full bar already reads as complete) */}
                            {status !== 'done' && (
                              <div
                                className={cn('absolute left-0 top-0 bottom-0 rounded-l', sStyle.barProgress)}
                                style={{ width: `${r.item.progress}%` }}
                              />
                            )}
                            <span className="relative px-1 truncate pointer-events-none">{label}</span>

                            {canEdit && (
                              <>
                                <div
                                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                  onPointerDown={(e) => startDrag(e, r, 'resize-left')}
                                />
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                  onPointerDown={(e) => startDrag(e, r, 'resize-right')}
                                />
                              </>
                            )}
                            {outsideDots}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div>{r.item.name}</div>
                          {outsideNote}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Committed parent: the bar is the committed range, with a
                        dark edge; sub-tasks outside it show as hatched overflow. */}
                    {rect && eff && planned && plannedRect && kind === 'committed' && (
                      <>
                        {rect.x < plannedRect.x && (
                          <div
                            className="absolute top-1 rounded-l pointer-events-none"
                            style={{
                              left: rect.x,
                              width: plannedRect.x - rect.x,
                              height: ROW_HEIGHT - 8,
                              backgroundImage: OVERFLOW_BG,
                              border: `1px solid ${OVERFLOW_BORDER}`,
                              borderRight: 'none',
                            }}
                          />
                        )}
                        {rect.x + rect.w > plannedRect.x + plannedRect.w && (
                          <div
                            className="absolute top-1 rounded-r pointer-events-none"
                            style={{
                              left: plannedRect.x + plannedRect.w,
                              width: rect.x + rect.w - (plannedRect.x + plannedRect.w),
                              height: ROW_HEIGHT - 8,
                              backgroundImage: OVERFLOW_BG,
                              border: `1px solid ${OVERFLOW_BORDER}`,
                              borderLeft: 'none',
                            }}
                          />
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              data-keep-drawer
                              className={cn(
                                'absolute top-1 rounded border-2 text-[10px] flex items-center justify-center select-none cursor-pointer',
                                sStyle.bar,
                                sStyle.text,
                                isDragging && 'ring-2 ring-blue-300',
                              )}
                              style={{
                                left: plannedRect.x,
                                width: Math.max(plannedRect.w, 12),
                                height: ROW_HEIGHT - 8,
                                borderColor: sStyle.edgeHex,
                              }}
                              onClick={select}
                            >
                              {status !== 'done' && (
                                <div
                                  className={cn('absolute left-0 top-0 bottom-0 rounded-l-sm', sStyle.barProgress)}
                                  style={{ width: `${r.item.progress}%` }}
                                />
                              )}
                              <span className="relative px-1 truncate pointer-events-none flex items-center">
                                <CalendarCheck size={10} className="shrink-0 mr-1" />
                                <span className="truncate">{label}</span>
                              </span>

                              {canEdit && (
                                <>
                                  <div
                                    className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                    title={t('gantt.resizeCommitted')}
                                    onPointerDown={(e) => startDrag(e, r, 'resize-left')}
                                  />
                                  <div
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                                    title={t('gantt.resizeCommitted')}
                                    onPointerDown={(e) => startDrag(e, r, 'resize-right')}
                                  />
                                </>
                              )}
                              {outsideDots}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <div>{r.item.name}</div>
                            <div className="opacity-80">
                              {t('gantt.committedTooltip', {
                                start: formatDate(planned.s),
                                end: formatDate(planned.e),
                              })}
                              {(eff.s < planned.s || eff.e > planned.e) &&
                                ` · ${t('gantt.overflowTooltip', {
                                  count:
                                    (eff.s < planned.s ? workingDayHops(eff.s, planned.s, calendar) : 0) +
                                    (eff.e > planned.e ? workingDayHops(planned.e, eff.e, calendar) : 0),
                                })}`}
                            </div>
                            {outsideNote}
                          </TooltipContent>
                        </Tooltip>
                      </>
                    )}

                    {/* Fit-to-sub-tasks parent: a summary bracket over the
                        rolled-up span, label beside it. Read-only. */}
                    {rect && kind === 'fit' && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              data-keep-drawer
                              className="absolute cursor-pointer"
                              style={{
                                left: rect.x,
                                width: Math.max(rect.w, 12),
                                top: ROW_HEIGHT / 2 - 4,
                                height: 10,
                              }}
                              onClick={select}
                            >
                              <div className="absolute inset-x-0 top-0 h-[5px] rounded-sm" style={{ backgroundColor: sStyle.hex }} />
                              <SummaryCap className="absolute left-0 top-1" color={sStyle.hex} />
                              <SummaryCap className="absolute right-0 top-1" color={sStyle.hex} />
                              {outsideDots}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <div>{r.item.name}</div>
                            <div className="opacity-80">{t('gantt.fitTooltip')}</div>
                            {outsideNote}
                          </TooltipContent>
                        </Tooltip>
                        <span
                          className="absolute text-[10px] text-neutral-600 dark:text-neutral-300 whitespace-nowrap pointer-events-none"
                          style={{
                            left: rect.x + Math.max(rect.w, 12) + 6,
                            top: 0,
                            lineHeight: `${ROW_HEIGHT}px`,
                          }}
                        >
                          {label}
                        </span>
                      </>
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

// Downward end cap of a fit-to-sub-tasks summary bracket.
function SummaryCap({ className, color }: { className?: string; color: string }) {
  return (
    <svg className={className} width="8" height="6" viewBox="0 0 8 6" aria-hidden>
      <polygon points="0,0 8,0 4,6" fill={color} />
    </svg>
  );
}

// Toolbar key for the three bar kinds and the overflow hatch.
function BarLegend() {
  const t = useT();
  const blue = statusStyle('future');
  return (
    <div className="hidden lg:flex items-center gap-3 mr-2 text-[10px] text-neutral-500 dark:text-neutral-400">
      <span className="flex items-center gap-1">
        <span className={cn('inline-block w-4 h-2.5 rounded-sm', blue.bar)} />
        {t('gantt.legendTask')}
      </span>
      <span className="flex items-center gap-1">
        <span
          className={cn('inline-block w-4 h-2.5 rounded-sm border-2', blue.bar)}
          style={{ borderColor: blue.edgeHex }}
        />
        {t('gantt.legendCommitted')}
      </span>
      <span className="flex items-center gap-1">
        <span className="relative inline-block w-4 h-2.5">
          <span className="absolute inset-x-0 top-0.5 h-[4px] rounded-sm" style={{ backgroundColor: blue.hex }} />
          <SummaryCap className="absolute -left-px top-1" color={blue.hex} />
          <SummaryCap className="absolute -right-px top-1" color={blue.hex} />
        </span>
        {t('gantt.legendFit')}
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-4 h-2.5 rounded-sm"
          style={{ backgroundImage: OVERFLOW_BG, border: `1px solid ${OVERFLOW_BORDER}` }}
        />
        {t('gantt.legendOverflow')}
      </span>
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
  // From every live item, not just visible ones: a filter that hides all of a
  // parent's children must not turn it into a draggable leaf.
  const parentIds = new Set<string>();
  for (const it of items) {
    if (it.deleted_at) continue;
    if (it.parent_id) parentIds.add(it.parent_id);
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
        isParent: parentIds.has(it.id),
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
