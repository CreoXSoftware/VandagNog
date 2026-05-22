import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Minus, Play, Square, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import {
  useActiveTimer,
  useStartTimer,
  useStopTimer,
  useTimeEntriesRealtime,
  pushRecent,
} from '@/hooks/useTimeEntries';
import { useTrackerCatalog } from '@/hooks/useTrackerCatalog';
import { TaskTargetPicker, labelForTarget } from './TaskTargetPicker';
import { formatHMS } from '@/lib/timeFormat';
import type { TrackerTarget } from '@/types/db';

const POS_KEY = 'vn.tracker.widget.pos';
const COLLAPSED_KEY = 'vn.tracker.widget.collapsed';
const TARGET_KEY = 'vn.tracker.widget.target';

interface Pos { x: number; y: number }

export function FloatingTimerWidget() {
  const t = useT();
  useTimeEntriesRealtime();

  const { data: active } = useActiveTimer();
  const { data: catalog } = useTrackerCatalog();
  const start = useStartTimer();
  const stop = useStopTimer();

  const [collapsed, setCollapsed] = useState<boolean>(() => readBool(COLLAPSED_KEY, true));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [target, setTarget] = useState<TrackerTarget | null>(() => readTarget());
  const [pos, setPos] = useState<Pos>(() => readPos());
  const [now, setNow] = useState<number>(Date.now);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const collapsedBtnRef = useRef<HTMLButtonElement | null>(null);

  // Persist
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => { localStorage.setItem(POS_KEY, JSON.stringify(pos)); }, [pos]);
  useEffect(() => {
    if (target) localStorage.setItem(TARGET_KEY, JSON.stringify(target));
    else localStorage.removeItem(TARGET_KEY);
  }, [target]);

  // Clamp inside viewport whenever size/state changes
  useEffect(() => {
    function reclamp() {
      const el = collapsed ? collapsedBtnRef.current : widgetRef.current;
      const w = el?.offsetWidth ?? (collapsed ? 48 : 320);
      const h = el?.offsetHeight ?? (collapsed ? 48 : 40);
      setPos((p) => clampPos(p, w, h));
    }
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [collapsed]);

  // Tick when running
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Adopt running entry's target when applicable
  useEffect(() => {
    if (!active) return;
    setTarget({
      project_id: active.project_id,
      work_item_id: active.work_item_id,
      custom_task_text: active.custom_task_text,
    });
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsedMs = active ? Math.max(0, now - new Date(active.start_at).getTime()) : 0;
  const running = !!active;

  const label = useMemo(() => {
    if (!catalog) return null;
    if (active) {
      return labelForTarget(
        { project_id: active.project_id, work_item_id: active.work_item_id, custom_task_text: active.custom_task_text },
        catalog,
      );
    }
    if (target) return labelForTarget(target, catalog);
    return null;
  }, [active, target, catalog]);

  // ---- Drag ----------------------------------------------------------------
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const DRAG_THRESHOLD = 4;

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
  }, [pos]);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.moved = true;
    const el = collapsed ? collapsedBtnRef.current : widgetRef.current;
    const w = el?.offsetWidth ?? (collapsed ? 48 : 320);
    const h = el?.offsetHeight ?? (collapsed ? 48 : 40);
    setPos(clampPos({ x: s.origX + dx, y: s.origY + dy }, w, h));
  }, [collapsed]);
  const onDragEnd = useCallback(() => {
    if (dragState.current?.moved) justDragged.current = true;
    dragState.current = null;
  }, []);

  // ---- Actions -------------------------------------------------------------
  async function onStart() {
    if (!target) {
      setPickerOpen(true);
      return;
    }
    pushRecent(target);
    try {
      await start.mutateAsync({
        project_id: target.project_id,
        work_item_id: target.work_item_id,
        custom_task_text: target.custom_task_text,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function onStop() {
    try {
      await stop.mutateAsync();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // ---- Render -------------------------------------------------------------
  const base = 'fixed z-50 select-none shadow-lg';
  const runningRing = running ? 'ring-2 ring-red-500/70' : '';

  return (
    <>
      {collapsed ? (
        <button
          type="button"
          ref={collapsedBtnRef}
          aria-label={t('tracker.widgetExpand')}
          title={running ? t('tracker.running') : t('tracker.openWidget')}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onClick={(e) => {
            if (justDragged.current) {
              justDragged.current = false;
              e.preventDefault();
              return;
            }
            e.preventDefault();
            setCollapsed(false);
          }}
          className={[
            base, runningRing,
            'h-12 w-12 rounded-full bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900',
            'flex items-center justify-center hover:scale-105 transition-transform cursor-grab active:cursor-grabbing',
          ].join(' ')}
          style={{ left: pos.x, top: pos.y }}
        >
          {running ? (
            <span className="text-[10px] font-mono tabular-nums leading-none">{formatShortHMS(elapsedMs)}</span>
          ) : (
            <Timer size={20} />
          )}
        </button>
      ) : (
        <div
          ref={widgetRef}
          className={[
            base, runningRing,
            'h-10 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center pl-1 pr-1 gap-1',
          ].join(' ')}
          style={{ left: pos.x, top: pos.y }}
        >
          <div
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            className="h-8 w-5 flex items-center justify-center text-neutral-400 cursor-grab active:cursor-grabbing"
            title={t('tracker.liveTimer')}
          >
            <GripVertical size={14} />
          </div>

          <button
            type="button"
            data-no-drag
            onClick={() => setPickerOpen(true)}
            disabled={running}
            title={running ? t('tracker.cannotChangeRunning') : t('tracker.pickTarget')}
            className="h-8 max-w-[180px] min-w-0 px-2 rounded-full text-xs text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-70 disabled:cursor-default truncate"
          >
            {label ? (
              <span className="truncate block text-neutral-900 dark:text-neutral-100">
                {label[label.length - 1]}
              </span>
            ) : (
              <span className="text-neutral-400 dark:text-neutral-500">{t('tracker.pickTarget')}</span>
            )}
          </button>

          <div className="font-mono text-sm tabular-nums px-2 text-neutral-900 dark:text-neutral-100">
            {formatHMS(elapsedMs)}
          </div>

          <button
            type="button"
            data-no-drag
            onClick={running ? onStop : onStart}
            disabled={(!running && !target) || start.isPending || stop.isPending}
            aria-label={running ? t('tracker.stop') : t('tracker.start')}
            title={running ? t('tracker.stop') : t('tracker.start')}
            className={[
              'h-8 w-8 rounded-full flex items-center justify-center transition-colors shrink-0',
              running
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900 hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {running ? <Square size={14} /> : <Play size={14} />}
          </button>

          <button
            type="button"
            data-no-drag
            onClick={() => setCollapsed(true)}
            aria-label={t('tracker.widgetCollapse')}
            title={t('tracker.widgetCollapse')}
            className="h-8 w-6 rounded text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center"
          >
            <Minus size={12} />
          </button>
        </div>
      )}

      <TaskTargetPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={target}
        onPick={(tg) => setTarget(tg)}
      />
    </>
  );
}

// ---- Helpers ---------------------------------------------------------------

function formatShortHMS(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

function readPos(): Pos {
  if (typeof window === 'undefined') return { x: 100, y: 100 };
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (typeof p.x === 'number' && typeof p.y === 'number') return clampPos(p, 48, 48);
    }
  } catch { /* ignore */ }
  // Default: bottom-left, sized for the collapsed (48px) circle.
  const margin = 16;
  return clampPos(
    { x: margin, y: window.innerHeight - 48 - margin },
    48,
    48,
  );
}

function clampPos(p: Pos, w: number, h: number): Pos {
  if (typeof window === 'undefined') return p;
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  return { x: Math.min(maxX, Math.max(margin, p.x)), y: Math.min(maxY, Math.max(margin, p.y)) };
}

function readTarget(): TrackerTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TARGET_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as TrackerTarget;
    if (typeof t.project_id === 'string') return t;
  } catch { /* ignore */ }
  return null;
}
