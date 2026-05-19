import { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Dependency, WorkItem } from '@/types/db';
import { useRescheduleFrom } from '@/hooks/useWorkItems';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  TREE_WIDTH,
  addDays,
  computeRange,
  countWorkingDays,
  diffDays,
  formatWorkDuration,
  isoDow,
  parseDate,
  startOfDay,
  toDateString,
} from './ganttUtils';
import { Badge } from '@/components/ui/Badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { useI18n, useT } from '@/lib/i18n';

interface Props {
  projectId: string;
  workItems: WorkItem[];
  dependencies: Dependency[];
  workingDays: number[];
  onSelect: (id: string) => void;
  canEdit: boolean;
}

interface FlatRow {
  item: WorkItem;
  depth: number;
  hasChildren: boolean;
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

export function GanttView({ projectId, workItems, dependencies, workingDays, onSelect, canEdit }: Props) {
  const reschedule = useRescheduleFrom();
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';
  const workingSet = useMemo(() => new Set(workingDays), [workingDays]);
  const range = useMemo(() => computeRange(workItems), [workItems]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return new Set(workItems.filter((w) => w.level !== 'subtask').map((w) => w.id));
  });

  const flatRows = useMemo(() => flatten(workItems, expanded), [workItems, expanded]);
  const [drag, setDrag] = useState<DragState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());

  // Center on today initially
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayX = diffDays(today, range.start) * DAY_WIDTH;
    scrollRef.current.scrollLeft = Math.max(0, todayX - 200);
  }, [range.start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag handlers
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const dx = e.clientX - drag!.startX;
      const deltaDays = Math.round(dx / DAY_WIDTH);
      let ns = drag!.origStart;
      let ne = drag!.origEnd;
      if (drag!.mode === 'move') {
        ns = addDays(drag!.origStart, deltaDays);
        ne = addDays(drag!.origEnd, deltaDays);
      } else if (drag!.mode === 'resize-left') {
        ns = addDays(drag!.origStart, deltaDays);
        if (ns > drag!.origEnd) ns = drag!.origEnd;
      } else if (drag!.mode === 'resize-right') {
        ne = addDays(drag!.origEnd, deltaDays);
        if (ne < drag!.origStart) ne = drag!.origStart;
      }
      setDrag({ ...drag!, previewStart: ns, previewEnd: ne });
    }
    async function onUp() {
      const final = drag!;
      const changed =
        toDateString(final.previewStart) !== toDateString(final.origStart) ||
        toDateString(final.previewEnd) !== toDateString(final.origEnd);
      setDrag(null);
      if (changed) {
        try {
          await reschedule.mutateAsync({
            project_id: projectId,
            work_item_id: final.id,
            new_start: toDateString(final.previewStart),
            new_end: toDateString(final.previewEnd),
          });
        } catch (e) {
          toast.error((e as Error).message);
        }
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, projectId, reschedule]);

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

  function startDrag(e: React.PointerEvent, row: FlatRow, mode: DragMode) {
    if (!canEdit) return;
    if (row.hasChildren || row.item.level === 'epic') return; // rollup parents are read-only
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

  const totalWidth = range.days * DAY_WIDTH;
  const totalHeight = HEADER_HEIGHT + flatRows.length * ROW_HEIGHT;

  // Position helpers
  function rowIndexById(id: string): number {
    return flatRows.findIndex((r) => r.item.id === id);
  }
  function barRect(row: FlatRow): { x: number; w: number } | null {
    const isDragging = drag?.id === row.item.id;
    const s = isDragging ? drag!.previewStart : parseDate(row.item.start_date);
    const en = isDragging ? drag!.previewEnd : parseDate(row.item.end_date);
    if (!s || !en) return null;
    const x = diffDays(s, range.start) * DAY_WIDTH;
    const w = (diffDays(en, s) + 1) * DAY_WIDTH;
    return { x, w };
  }

  const todayX = diffDays(today, range.start) * DAY_WIDTH;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-900">
      <div className="h-10 px-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs shrink-0">
        <button onClick={expandAll} className="px-2 h-7 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">{t('gantt.expandAll')}</button>
        <button onClick={collapseAll} className="px-2 h-7 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800">{t('gantt.collapseAll')}</button>
        <div className="flex-1" />
        <div className="text-neutral-500 dark:text-neutral-400">{t('gantt.visibleTotal', { visible: flatRows.length, total: workItems.length })}</div>
      </div>
      <div className="flex-1 overflow-hidden flex">
        {/* Tree column (left, fixed) */}
        <div className="border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0" style={{ width: TREE_WIDTH }}>
          <div
            className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 flex items-center px-3"
            style={{ height: HEADER_HEIGHT }}
          >
            {t('gantt.workItem')}
          </div>
          <div className="overflow-y-auto" style={{ height: `calc(100% - ${HEADER_HEIGHT}px)` }}>
            {flatRows.map((r) => {
              const s = parseDate(r.item.start_date);
              const en = parseDate(r.item.end_date);
              const wd = s && en ? countWorkingDays(s, en, workingSet) : 0;
              return (
                <div
                  key={r.item.id}
                  onClick={() => onSelect(r.item.id)}
                  className="flex items-center gap-1 px-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800"
                  style={{ height: ROW_HEIGHT, paddingLeft: 8 + r.depth * 14 }}
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
                  <Badge kind={r.item.level}>{r.item.level[0].toUpperCase()}</Badge>
                  <span className="text-xs truncate flex-1">{r.item.name}</span>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-7 text-right">{formatWorkDuration(wd)}</span>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 w-7 text-right">{r.item.progress}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline column (right, scrollable) */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
          <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
            {/* Header: month + day strip */}
            <TimelineHeader range={range} todayX={todayX} workingSet={workingSet} locale={locale} />

            {/* Weekend & today background overlay */}
            <div
              className="absolute left-0 pointer-events-none"
              style={{ top: HEADER_HEIGHT, width: totalWidth, height: totalHeight - HEADER_HEIGHT }}
            >
              {Array.from({ length: range.days }, (_, i) => {
                const d = addDays(range.start, i);
                const isWeekend = !workingSet.has(isoDow(d));
                return isWeekend ? (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 bg-neutral-50 dark:bg-neutral-800/40"
                    style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                  />
                ) : null;
              })}
              {/* Today line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-red-400"
                  style={{ left: todayX + DAY_WIDTH / 2 }}
                />
              )}
            </div>

            {/* Rows */}
            <div className="absolute left-0" style={{ top: HEADER_HEIGHT, width: totalWidth }}>
              {flatRows.map((r) => {
                const rect = barRect(r);
                const isRollup = r.hasChildren || r.item.level === 'epic';
                return (
                  <div
                    key={r.item.id}
                    className="relative border-b border-neutral-100 dark:border-neutral-800"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {rect && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'absolute top-1 rounded text-[10px] text-white flex items-center justify-center select-none',
                              isRollup ? 'bg-neutral-700 dark:bg-neutral-600 cursor-default' : 'bg-blue-500 cursor-move',
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
                                isRollup ? 'bg-neutral-900/40' : 'bg-blue-700',
                              )}
                              style={{ width: `${r.item.progress}%` }}
                            />
                            <span className="relative px-1 truncate pointer-events-none">{r.item.name}</span>

                            {!isRollup && canEdit && (
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

function TimelineHeader({ range, todayX, workingSet, locale }: { range: ReturnType<typeof computeRange>; todayX: number; workingSet: Set<number>; locale: string }) {
  const months: { label: string; x: number; width: number }[] = [];
  let curMonthKey = '';
  let curStart = 0;
  for (let i = 0; i < range.days; i++) {
    const d = addDays(range.start, i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== curMonthKey) {
      if (curMonthKey) {
        months.push({
          label: monthLabel(addDays(range.start, curStart), locale),
          x: curStart * DAY_WIDTH,
          width: (i - curStart) * DAY_WIDTH,
        });
      }
      curMonthKey = key;
      curStart = i;
    }
  }
  months.push({
    label: monthLabel(addDays(range.start, curStart), locale),
    x: curStart * DAY_WIDTH,
    width: (range.days - curStart) * DAY_WIDTH,
  });

  return (
    <div
      className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
      style={{ height: HEADER_HEIGHT, width: range.days * DAY_WIDTH }}
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
        {Array.from({ length: range.days }, (_, i) => {
          const d = addDays(range.start, i);
          const weekend = !workingSet.has(isoDow(d));
          const isToday = i * DAY_WIDTH === todayX;
          return (
            <div
              key={i}
              className={cn(
                'absolute top-0 bottom-0 flex items-center justify-center text-[10px] border-r border-neutral-100 dark:border-neutral-800',
                weekend && 'text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800/60',
                isToday && 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 font-semibold',
              )}
              style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
            >
              {d.getDate()}
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

function flatten(items: WorkItem[], expanded: Set<string>): FlatRow[] {
  const byParent = new Map<string | null, WorkItem[]>();
  for (const it of items) {
    const k = it.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(it);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  }
  const out: FlatRow[] = [];
  function walk(parent: string | null, depth: number) {
    const list = byParent.get(parent) ?? [];
    for (const it of list) {
      const children = byParent.get(it.id) ?? [];
      out.push({ item: it, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && expanded.has(it.id)) {
        walk(it.id, depth + 1);
      }
    }
  }
  walk(null, 0);
  return out;
}
