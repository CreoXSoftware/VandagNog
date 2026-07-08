import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  addDays,
  buildDayAxis,
  computeRange,
  diffDays,
  isWorkingDay,
  isoDow,
  startOfDay,
  toDateString,
  type WorkCalendar,
} from '@/components/gantt/ganttUtils';
import { packByProject } from '@/lib/workload';
import type { WorkItem } from '@/types/db';
import type { WorkloadPerson } from '@/hooks/useWorkloadData';

export interface WorkloadRow {
  person: WorkloadPerson;
  tasks: WorkItem[];
}

interface Props {
  rows: WorkloadRow[];
  calendar: WorkCalendar;
  projectNameById: Map<string, string>;
}

const PEOPLE_W = 240;
const HEADER_H = 48;
const TOP_TIER_H = 22;
const PERSON_HEADER_H = 30;
const BAR_H = 20;
const LANE_GAP = 4;
const ROW_PAD = 5;

// Continuous axis padding (calendar days) so you can scroll into empty time.
const PAD_LEFT = 30;
const PAD_RIGHT = 120;

const ZOOM_MIN = 2;
const ZOOM_MAX = 100;
const DEFAULT_DAY_WIDTH = 12; // ≈ "week" preset
const OFF_RATIO = 0.3;

// Day/Week/Month act as zoom presets (column width per working day).
const PRESETS = [
  { key: 'day' as const, width: 28 },
  { key: 'week' as const, width: 12 },
  { key: 'month' as const, width: 4 },
];

type HeaderMode = 'day' | 'week' | 'month';
function headerModeFor(dayWidth: number): HeaderMode {
  if (dayWidth >= 18) return 'day';
  if (dayWidth >= 6) return 'week';
  return 'month';
}

function laneRowHeight(laneCount: number): number {
  return Math.max(30, ROW_PAD * 2 + laneCount * BAR_H + (laneCount - 1) * LANE_GAP);
}

// Status colouring matches the Gantt's progress/overdue conventions.
function barColor(item: WorkItem, today: string): string {
  if (item.end_date && item.end_date < today && item.progress < 100) {
    return 'bg-red-500/85 hover:bg-red-500 text-white';
  }
  if (item.progress >= 100) return 'bg-emerald-500/85 hover:bg-emerald-500 text-white';
  if (item.progress > 0) return 'bg-blue-500/85 hover:bg-blue-500 text-white';
  return 'bg-neutral-400 hover:bg-neutral-500 text-white dark:bg-neutral-600 dark:hover:bg-neutral-500';
}

export function WorkloadView({ rows, calendar, projectNameById }: Props) {
  const t = useT();
  const today = toDateString(new Date());

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [dayWidth, setDayWidth] = useState(DEFAULT_DAY_WIDTH);
  const dayWidthRef = useRef(dayWidth);
  useEffect(() => {
    dayWidthRef.current = dayWidth;
  }, [dayWidth]);

  // Continuous date range derived from all visible tasks, padded generously so the
  // timeline scrolls past the data on both sides.
  const allTasks = useMemo(() => rows.flatMap((r) => r.tasks), [rows]);
  const range = useMemo(() => computeRange(allTasks), [allTasks]);
  const viewStart = useMemo(() => addDays(range.start, -PAD_LEFT), [range.start]);
  const baseDays = range.days + PAD_LEFT + PAD_RIGHT;
  const effectiveDays = Math.max(baseDays, Math.ceil(viewportWidth / Math.max(2, dayWidth)));

  const offWidth = Math.max(2, Math.round(dayWidth * OFF_RATIO));
  const axis = useMemo(
    () => buildDayAxis(viewStart, effectiveDays, dayWidth, offWidth, calendar),
    [viewStart, effectiveDays, dayWidth, offWidth, calendar],
  );
  const axisRef = useRef(axis);
  useEffect(() => {
    axisRef.current = axis;
  }, [axis]);

  const headerMode = headerModeFor(dayWidth);

  // Center on today whenever the date range changes (initial + on filter changes).
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayX = axisRef.current.xOf(diffDays(startOfDay(new Date()), viewStart));
    scrollRef.current.scrollLeft = Math.max(0, todayX - 200);
  }, [viewStart]);

  // Re-pin the day under the cursor (or viewport center) after a zoom changes the axis.
  const pendingZoom = useRef<{ dayIndex: number; frac: number; ax: number } | null>(null);
  useLayoutEffect(() => {
    const p = pendingZoom.current;
    if (!p || !scrollRef.current) return;
    pendingZoom.current = null;
    const newAnchorPx = axis.xOf(p.dayIndex) + p.frac * axis.widthOf(p.dayIndex);
    scrollRef.current.scrollLeft = newAnchorPx - p.ax;
  }, [axis]);

  function applyZoom(nextWidth: number, anchorClientX?: number) {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextWidth));
    const cur = dayWidthRef.current;
    if (next === cur) return;
    const rect = el.getBoundingClientRect();
    const ax = anchorClientX != null ? anchorClientX - rect.left : el.clientWidth / 2;
    const cAxis = axisRef.current;
    const anchorPx = el.scrollLeft + ax;
    const dayIndex = cAxis.indexAtX(anchorPx);
    const frac = (anchorPx - cAxis.xOf(dayIndex)) / cAxis.widthOf(dayIndex);
    pendingZoom.current = { dayIndex, frac, ax };
    setDayWidth(next);
  }
  function zoomBy(factor: number, anchorClientX?: number) {
    applyZoom(dayWidthRef.current * factor, anchorClientX);
  }
  function scrollToToday() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, axisRef.current.xOf(diffDays(startOfDay(new Date()), viewStart)) - 200);
  }

  // Ctrl/⌘+wheel = zoom (anchored at cursor); Shift+wheel = horizontal pan.
  // Plain wheel falls through to native vertical scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
        return;
      }
      if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        el!.scrollLeft += e.deltaY;
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- zoomBy reads live refs

  // Group each person's tasks by project, lane-packed independently.
  const groups = useMemo(
    () =>
      rows.map((row) => {
        const projects = packByProject(row.tasks, calendar)
          .map((pr) => ({
            ...pr,
            name: projectNameById.get(pr.projectId) ?? '—',
            height: laneRowHeight(pr.laneCount),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          person: row.person,
          projects,
          taskCount: row.tasks.length,
          workDays: projects.reduce((s, p) => s + p.workDays, 0),
        };
      }),
    [rows, calendar, projectNameById],
  );

  // Header ticks + month band + non-working shading.
  const { months, ticks, offDays } = useMemo(() => {
    const months: { x: number; label: string }[] = [];
    const ticks: { x: number; width: number; top: string; bottom: string }[] = [];
    const offDays: { x: number; width: number }[] = [];
    for (let i = 0; i < effectiveDays; i++) {
      const d = addDays(viewStart, i);
      const x = axis.xOf(i);
      const working = isWorkingDay(d, calendar);
      if (!working) offDays.push({ x, width: axis.widthOf(i) });
      if (i === 0 || d.getDate() === 1) {
        months.push({ x, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) });
      }
      if (headerMode === 'day') {
        ticks.push({
          x,
          width: axis.widthOf(i),
          top: working ? d.toLocaleDateString(undefined, { weekday: 'narrow' }) : '',
          bottom: working ? String(d.getDate()) : '',
        });
      } else if (headerMode === 'week') {
        if (i === 0 || isoDow(d) === 1) {
          ticks.push({
            x,
            width: 0,
            top: '',
            bottom: `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`,
          });
        }
      }
    }
    return { months, ticks, offDays };
  }, [axis, viewStart, effectiveDays, headerMode, calendar]);

  const todayIdx = diffDays(new Date(), viewStart);
  const todayX = todayIdx >= 0 && todayIdx <= effectiveDays ? axis.xOf(todayIdx) : null;
  const contentW = PEOPLE_W + axis.total;

  function renderBars(placed: { item: WorkItem; start: Date; end: Date; lane: number }[]) {
    return placed.map((p) => {
      const startIdx = diffDays(p.start, viewStart);
      const endIdx = diffDays(p.end, viewStart);
      if (endIdx < 0 || startIdx > effectiveDays - 1) return null;
      const left = Math.max(0, axis.xOf(startIdx));
      const right = Math.min(axis.total, axis.xOf(endIdx + 1));
      const width = Math.max(4, right - left);
      const top = ROW_PAD + p.lane * (BAR_H + LANE_GAP);
      const projectName = projectNameById.get(p.item.project_id) ?? '';
      return (
        <Link
          key={p.item.id}
          to="/projects/$projectId"
          params={{ projectId: p.item.project_id }}
          search={{ item: p.item.id, view: 'gantt' }}
          title={`${p.item.name}${projectName ? ` · ${projectName}` : ''}\n${p.item.start_date} → ${p.item.end_date}`}
          className={`absolute rounded px-1.5 flex items-center text-[11px] truncate shadow-sm ${barColor(p.item, today)}`}
          style={{ left, width, top, height: BAR_H }}
        >
          <span className="truncate">{p.item.name}</span>
        </Link>
      );
    });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Timeline toolbar: zoom presets + Today + zoom controls. */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-neutral-200 dark:border-neutral-800">
        <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyZoom(p.width)}
              className={cn(
                'px-2.5 h-6 text-[11px] rounded',
                headerMode === p.key
                  ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
              )}
            >
              {t(`workload.${p.key}`)}
            </button>
          ))}
        </div>
        <button
          onClick={scrollToToday}
          className="h-6 px-2 rounded text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {t('workload.today')}
        </button>

        <div className="flex-1" />

        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 hidden md:inline">
          {t('workload.zoomHint')}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoomBy(1 / 1.25)}
            disabled={dayWidth <= ZOOM_MIN}
            aria-label={t('workload.zoomOut')}
            title={t('workload.zoomOut')}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => applyZoom(DEFAULT_DAY_WIDTH)}
            title={t('workload.resetZoom')}
            className="px-1.5 h-6 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400"
          >
            {Math.round((dayWidth / DEFAULT_DAY_WIDTH) * 100)}%
          </button>
          <button
            onClick={() => zoomBy(1.25)}
            disabled={dayWidth >= ZOOM_MAX}
            aria-label={t('workload.zoomIn')}
            title={t('workload.zoomIn')}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-white dark:bg-neutral-950">
        <div className="relative" style={{ width: contentW, minWidth: '100%' }}>
          {/* Background layer: weekend/holiday shading + today line (behind rows). */}
          <div
            className="absolute pointer-events-none"
            style={{ left: PEOPLE_W, top: HEADER_H, width: axis.total, bottom: 0 }}
          >
            {offDays.map((o, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 bg-neutral-100/70 dark:bg-neutral-900/50"
                style={{ left: o.x, width: o.width }}
              />
            ))}
            {todayX !== null && (
              <div className="absolute top-0 bottom-0 w-px bg-red-400/70" style={{ left: todayX }} />
            )}
          </div>

          {/* Header (sticky top). */}
          <div
            className="sticky top-0 z-20 flex bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
            style={{ height: HEADER_H }}
          >
            <div
              className="sticky left-0 z-30 shrink-0 flex items-end px-3 pb-1 bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              style={{ width: PEOPLE_W }}
            >
              {t('workload.person')}
            </div>
            <div className="relative" style={{ width: axis.total }}>
              <div className="relative" style={{ height: TOP_TIER_H }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-1 text-[10px] font-medium text-neutral-600 dark:text-neutral-300 whitespace-nowrap"
                    style={{ left: m.x + 2 }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="relative" style={{ height: HEADER_H - TOP_TIER_H }}>
                {ticks.map((tk, i) =>
                  headerMode === 'day' ? (
                    <div
                      key={i}
                      className="absolute top-0 text-center leading-tight"
                      style={{ left: tk.x, width: tk.width }}
                    >
                      <div className="text-[8px] text-neutral-400 dark:text-neutral-500">{tk.top}</div>
                      <div className="text-[10px] tabular-nums text-neutral-600 dark:text-neutral-300">
                        {tk.bottom}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="absolute top-1 text-[10px] tabular-nums text-neutral-600 dark:text-neutral-300 whitespace-nowrap"
                      style={{ left: tk.x + 2 }}
                    >
                      {tk.bottom}
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* Person groups. */}
          {groups.map((g) => (
            <div key={g.person.user_id} className="border-t-2 border-neutral-300 dark:border-neutral-700">
              {/* Person band */}
              <div className="flex bg-neutral-100 dark:bg-neutral-900" style={{ height: PERSON_HEADER_H }}>
                <div
                  className="sticky left-0 z-10 shrink-0 flex items-center gap-2 px-3 bg-neutral-100 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800"
                  style={{ width: PEOPLE_W }}
                >
                  <Avatar user={g.person} size="xs" />
                  <span className="text-xs font-semibold truncate text-neutral-800 dark:text-neutral-100">
                    {g.person.display_name}
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                    {t('workload.taskSummary', { tasks: g.taskCount, days: g.workDays })}
                  </span>
                </div>
                <div style={{ width: axis.total }} />
              </div>

              {/* One sub-row per project */}
              {g.projects.map((pr) => (
                <div
                  key={pr.projectId}
                  className="flex border-t border-neutral-100 dark:border-neutral-900/80"
                  style={{ height: pr.height }}
                >
                  <div
                    className="sticky left-0 z-10 shrink-0 flex items-center gap-1.5 pl-8 pr-3 bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800"
                    style={{ width: PEOPLE_W }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600 shrink-0" />
                    <span className="text-[11px] truncate text-neutral-700 dark:text-neutral-300" title={pr.name}>
                      {pr.name}
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-400 dark:text-neutral-500 tabular-nums">
                      {pr.placed.length}
                    </span>
                  </div>
                  <div className="relative" style={{ width: axis.total, height: pr.height }}>
                    {renderBars(pr.placed)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
