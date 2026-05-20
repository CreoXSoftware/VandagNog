import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { NonWorkingDay } from '@/types/db';
import {
  useCreateNonWorkingDay,
  useDeleteNonWorkingDay,
  useUpdateNonWorkingDay,
} from '@/hooks/useNonWorkingDays';
import {
  addDays,
  diffDays,
  isoDow,
  parseDate,
  startOfDay,
  toDateString,
} from '@/components/gantt/ganttUtils';
import { useI18n, useT } from '@/lib/i18n';

interface Props {
  projectId: string;
  workingDays: number[];
  nonWorkingDays: NonWorkingDay[];
  canEdit: boolean;
}

export function CalendarView({ projectId, workingDays, nonWorkingDays, canEdit }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';
  const create = useCreateNonWorkingDay();
  const update = useUpdateNonWorkingDay();
  const del = useDeleteNonWorkingDay();

  const weeklySet = useMemo(() => new Set(workingDays), [workingDays]);

  const today = startOfDay(new Date());
  const [anchor, setAnchor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const nonWorkingMap = useMemo(() => {
    const m = new Map<string, NonWorkingDay>();
    for (const r of nonWorkingDays) {
      const s = parseDate(r.start_date);
      const e = parseDate(r.end_date);
      if (!s || !e) continue;
      const n = diffDays(e, s);
      for (let i = 0; i <= n; i++) {
        m.set(toDateString(addDays(s, i)), r);
      }
    }
    return m;
  }, [nonWorkingDays]);

  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null);

  function handleDayPointerDown(d: Date) {
    if (!canEdit) return;
    const ds = toDateString(d);
    const existing = nonWorkingMap.get(ds);
    if (existing) {
      if (confirm(t('calendar.removeConfirm', { reason: existing.reason || t('calendar.unlabeled') }))) {
        del.mutate(
          { id: existing.id, project_id: projectId },
          { onError: (e) => toast.error((e as Error).message) },
        );
      }
      return;
    }
    setDragRange({ start: ds, end: ds });
  }

  function handleDayPointerEnter(d: Date) {
    if (!dragRange) return;
    setDragRange((cur) => (cur ? { ...cur, end: toDateString(d) } : cur));
  }

  function handlePointerUp() {
    if (!dragRange) return;
    const a = dragRange.start;
    const b = dragRange.end;
    const start = a < b ? a : b;
    const end = a < b ? b : a;
    setDragRange(null);
    const reason = window.prompt(t('calendar.reasonPrompt')) ?? '';
    create.mutate(
      { project_id: projectId, start_date: start, end_date: end, reason: reason.trim() || null },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  const months = [0, 1, 2].map((off) => new Date(anchor.getFullYear(), anchor.getMonth() + off, 1));

  return (
    <div className="h-full flex flex-col bg-white dark:bg-neutral-900" onPointerUp={handlePointerUp}>
      <div className="h-10 px-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2 text-xs shrink-0">
        <button
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label={t('calendar.prev')}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}
          className="px-2 h-6 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {t('calendar.today')}
        </button>
        <button
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
          className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label={t('calendar.next')}
        >
          <ChevronRight size={14} />
        </button>
        <div className="flex-1" />
        <div className="text-neutral-500 dark:text-neutral-400">
          {canEdit ? t('calendar.helpEdit') : t('calendar.helpView')}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {months.map((m) => (
            <MonthGrid
              key={`${m.getFullYear()}-${m.getMonth()}`}
              month={m}
              locale={locale}
              today={today}
              weeklySet={weeklySet}
              nonWorkingMap={nonWorkingMap}
              dragRange={dragRange}
              canEdit={canEdit}
              onDayDown={handleDayPointerDown}
              onDayEnter={handleDayPointerEnter}
            />
          ))}
        </div>

        <RangesList
          projectId={projectId}
          ranges={nonWorkingDays}
          canEdit={canEdit}
          locale={locale}
          onUpdate={(id, patch) =>
            update.mutate(
              { id, project_id: projectId, patch },
              { onError: (e) => toast.error((e as Error).message) },
            )
          }
          onDelete={(id) =>
            del.mutate(
              { id, project_id: projectId },
              { onError: (e) => toast.error((e as Error).message) },
            )
          }
          onCreate={(start, end, reason) =>
            create.mutate(
              { project_id: projectId, start_date: start, end_date: end, reason: reason || null },
              { onError: (e) => toast.error((e as Error).message) },
            )
          }
        />
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  locale,
  today,
  weeklySet,
  nonWorkingMap,
  dragRange,
  canEdit,
  onDayDown,
  onDayEnter,
}: {
  month: Date;
  locale: string;
  today: Date;
  weeklySet: Set<number>;
  nonWorkingMap: Map<string, NonWorkingDay>;
  dragRange: { start: string; end: string } | null;
  canEdit: boolean;
  onDayDown: (d: Date) => void;
  onDayEnter: (d: Date) => void;
}) {
  const firstDow = isoDow(month); // 1..7 (Mon..Sun)
  const offset = firstDow - 1; // cells before the 1st
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));
  while (cells.length % 7 !== 0) cells.push(null);

  const dragLo = dragRange ? (dragRange.start < dragRange.end ? dragRange.start : dragRange.end) : null;
  const dragHi = dragRange ? (dragRange.start < dragRange.end ? dragRange.end : dragRange.start) : null;

  const dowLabels = useMemo(() => {
    const ref = new Date(2024, 0, 1); // Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ref, i);
      return d.toLocaleDateString(locale, { weekday: 'short' });
    });
  }, [locale]);

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded">
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 text-sm font-medium bg-neutral-50 dark:bg-neutral-950">
        {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
      </div>
      <div className="grid grid-cols-7 text-[10px] text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
        {dowLabels.map((l, i) => (
          <div key={i} className="px-1 py-1 text-center">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-9 border-r border-b border-neutral-100 dark:border-neutral-800/60 last:border-r-0" />;
          const ds = toDateString(d);
          const isWeekend = !weeklySet.has(isoDow(d));
          const isHoliday = nonWorkingMap.has(ds);
          const reason = isHoliday ? nonWorkingMap.get(ds)?.reason : null;
          const isToday = ds === toDateString(today);
          const inDrag = dragLo && dragHi && ds >= dragLo && ds <= dragHi;
          return (
            <div
              key={i}
              title={isHoliday ? reason || undefined : undefined}
              onPointerDown={() => onDayDown(d)}
              onPointerEnter={() => onDayEnter(d)}
              className={cn(
                'h-9 px-1.5 py-1 border-r border-b border-neutral-100 dark:border-neutral-800/60 text-[11px] select-none flex flex-col',
                (i + 1) % 7 === 0 && 'border-r-0',
                canEdit && 'cursor-pointer',
                isWeekend && !isHoliday && 'bg-neutral-50 dark:bg-neutral-800/40',
                isHoliday && 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200',
                inDrag && 'ring-1 ring-blue-400 bg-blue-50 dark:bg-blue-950/40',
                isToday && 'outline outline-1 outline-red-400',
              )}
            >
              <span className={cn('tabular-nums', isToday && 'text-red-600 dark:text-red-400 font-semibold')}>{d.getDate()}</span>
              {reason && (
                <span className="text-[9px] leading-tight truncate text-amber-800 dark:text-amber-300">{reason}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RangesList({
  ranges,
  canEdit,
  locale,
  onUpdate,
  onDelete,
  onCreate,
}: {
  projectId: string;
  ranges: NonWorkingDay[];
  canEdit: boolean;
  locale: string;
  onUpdate: (id: string, patch: { start_date?: string; end_date?: string; reason?: string | null }) => void;
  onDelete: (id: string) => void;
  onCreate: (start: string, end: string, reason: string | null) => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newReason, setNewReason] = useState('');

  function fmt(s: string): string {
    const d = parseDate(s);
    return d ? d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : s;
  }

  function submitNew() {
    if (!newStart || !newEnd) {
      toast.error(t('calendar.needDates'));
      return;
    }
    const start = newStart < newEnd ? newStart : newEnd;
    const end = newStart < newEnd ? newEnd : newStart;
    onCreate(start, end, newReason.trim() || null);
    setAdding(false);
    setNewStart('');
    setNewEnd('');
    setNewReason('');
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{t('calendar.ranges')}</h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            <Plus size={12} /> {t('calendar.addRange')}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 p-3 border border-dashed border-neutral-300 dark:border-neutral-700 rounded mb-3 bg-neutral-50 dark:bg-neutral-950">
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">{t('workItem.start')}</label>
            <Input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] text-neutral-500 mb-1">{t('workItem.end')}</label>
            <Input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] text-neutral-500 mb-1">{t('calendar.reason')}</label>
            <Input placeholder={t('calendar.reasonPlaceholder')} value={newReason} onChange={(e) => setNewReason(e.target.value)} />
          </div>
          <Button size="sm" onClick={submitNew}>{t('common.add')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
        </div>
      )}

      {ranges.length === 0 ? (
        <div className="text-xs text-neutral-500 dark:text-neutral-400 py-6 text-center border border-dashed border-neutral-300 dark:border-neutral-700 rounded">
          {t('calendar.none')}
        </div>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded divide-y divide-neutral-100 dark:divide-neutral-800">
          {ranges.map((r) => (
            <RangeRow
              key={r.id}
              range={r}
              canEdit={canEdit}
              fmt={fmt}
              onUpdate={(patch) => onUpdate(r.id, patch)}
              onDelete={() => onDelete(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RangeRow({
  range,
  canEdit,
  fmt,
  onUpdate,
  onDelete,
}: {
  range: NonWorkingDay;
  canEdit: boolean;
  fmt: (s: string) => string;
  onUpdate: (patch: { start_date?: string; end_date?: string; reason?: string | null }) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(range.reason ?? '');
  const [start, setStart] = useState(range.start_date);
  const [end, setEnd] = useState(range.end_date);

  function commit() {
    const patch: { start_date?: string; end_date?: string; reason?: string | null } = {};
    if (reason !== (range.reason ?? '')) patch.reason = reason.trim() || null;
    if (start !== range.start_date) patch.start_date = start;
    if (end !== range.end_date) patch.end_date = end;
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  }

  const single = range.start_date === range.end_date;

  return (
    <div className="px-3 py-2 flex items-center gap-3 text-sm">
      {editing ? (
        <>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-36" />
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-36" />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('calendar.reasonPlaceholder')} className="flex-1" />
          <Button size="sm" onClick={commit}>{t('common.save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setReason(range.reason ?? ''); setStart(range.start_date); setEnd(range.end_date); }}>{t('common.cancel')}</Button>
        </>
      ) : (
        <>
          <div className="w-56 shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
            {single ? fmt(range.start_date) : `${fmt(range.start_date)} → ${fmt(range.end_date)}`}
          </div>
          <div className="flex-1 truncate">
            {range.reason || <span className="text-neutral-400 dark:text-neutral-500 italic">{t('calendar.unlabeled')}</span>}
          </div>
          {canEdit && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t('common.edit')}
              </button>
              <button
                onClick={() => { if (confirm(t('calendar.removeConfirm', { reason: range.reason || t('calendar.unlabeled') }))) onDelete(); }}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-950 rounded text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                aria-label={t('common.delete')}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
