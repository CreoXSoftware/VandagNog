import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatHoursDecimal, isoDate, weekStartIso } from '@/lib/timeFormat';
import type { ReportRow } from '@/lib/exporters/trackerExports';

// Minimal charts over the filtered report rows: hours over time and a ranked
// breakdown. Both are one series, so a single hue carries them and there is no
// legend; the summary table below remains the full table view.

const BAR = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const BAR_DIM = 'bg-[#2a78d6]/55 dark:bg-[#3987e5]/55';
const HOUR_MS = 3_600_000;
const BREAKDOWN_TOP = 8;

type Grain = 'day' | 'week' | 'month';
type Dim = 'project' | 'client' | 'task' | 'user';

interface Props {
  rows: ReportRow[];
  since: string; // YYYY-MM-DD inclusive
  until: string; // YYYY-MM-DD exclusive
  /** A single project is filtered, so tasks are the useful default breakdown. */
  projectFiltered: boolean;
}

export function ReportCharts({ rows, since, until, projectFiltered }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
      <div className="lg:col-span-3 min-w-0">
        <HoursOverTime rows={rows} since={since} until={until} />
      </div>
      <div className="lg:col-span-2 min-w-0">
        <Breakdown rows={rows} defaultDim={projectFiltered ? 'task' : 'project'} />
      </div>
    </div>
  );
}

// ----- Hours over time --------------------------------------------------------

interface Bucket {
  key: string;
  label: string;
  tick: string;
  ms: number;
}

function grainFor(days: number): Grain {
  if (days <= 45) return 'day';
  if (days <= 26 * 7) return 'week';
  return 'month';
}

function buildBuckets(rows: ReportRow[], since: string, until: string): { grain: Grain; buckets: Bucket[] } {
  const start = new Date(since + 'T00:00:00');
  const end = new Date(until + 'T00:00:00');
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const grain = grainFor(days);
  const keyOf = (d: Date) =>
    grain === 'day' ? isoDate(d) : grain === 'week' ? weekStartIso(d) : isoDate(d).slice(0, 7);

  // Every bucket in range, so empty days show as gaps rather than vanishing.
  const buckets: Bucket[] = [];
  const index = new Map<string, Bucket>();
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const key = keyOf(d);
    if (index.has(key)) continue;
    const b: Bucket = {
      key,
      label:
        grain === 'month'
          ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : grain === 'week'
            ? weekLabel(key)
            : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
      tick:
        grain === 'month'
          ? d.toLocaleDateString(undefined, { month: 'short' })
          : grain === 'week'
            ? new Date(key + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            : String(d.getDate()),
      ms: 0,
    };
    index.set(key, b);
    buckets.push(b);
  }
  for (const r of rows) {
    const b = index.get(keyOf(new Date(r.date + 'T00:00:00')));
    if (b) b.ms += r.durationMs;
  }
  return { grain, buckets };
}

function weekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Round the axis top up to a friendly hour count, with 2–4 gridlines.
function niceScale(maxHours: number): { top: number; ticks: number[] } {
  if (maxHours <= 0) return { top: 1, ticks: [0, 1] };
  const steps = [0.5, 1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => maxHours / s <= 4) ?? Math.ceil(maxHours / 4);
  const top = Math.ceil(maxHours / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

function HoursOverTime({ rows, since, until }: { rows: ReportRow[]; since: string; until: string }) {
  const t = useT();
  const { grain, buckets } = useMemo(() => buildBuckets(rows, since, until), [rows, since, until]);
  const maxHours = Math.max(0, ...buckets.map((b) => b.ms / HOUR_MS));
  const { top, ticks } = niceScale(maxHours);
  const [hover, setHover] = useState<number | null>(null);
  // Thin the x labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const H = 160;

  return (
    <ChartCard title={t(`tracker.chart.hoursPer.${grain}` as const)}>
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative shrink-0 w-8 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400" style={{ height: H }}>
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: H - (v / top) * H }}>
              {formatTick(v)}
            </span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          {/* Gridlines */}
          <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: H }}>
            {ticks.map((v) => (
              <div
                key={v}
                className={cn(
                  'absolute inset-x-0 h-px',
                  v === 0 ? 'bg-neutral-300 dark:bg-neutral-700' : 'bg-neutral-200/70 dark:bg-neutral-800',
                )}
                style={{ top: H - (v / top) * H }}
              />
            ))}
          </div>

          {/* Columns: the whole column slot is the hover target. */}
          <div className="relative flex items-end gap-[2px]" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {buckets.map((b, i) => {
              const h = (b.ms / HOUR_MS / top) * H;
              return (
                <div
                  key={b.key}
                  className="relative flex-1 min-w-0 h-full flex items-end"
                  onMouseEnter={() => setHover(i)}
                >
                  <div
                    className={cn('w-full rounded-t-[4px]', hover === null || hover === i ? BAR : BAR_DIM)}
                    style={{ height: b.ms > 0 ? Math.max(2, h) : 0 }}
                  />
                </div>
              );
            })}
            {hover !== null && (
              <Tooltip
                leftPct={((hover + 0.5) / buckets.length) * 100}
                bottomPx={Math.min(H - 24, (buckets[hover].ms / HOUR_MS / top) * H) + 6}
                title={buckets[hover].label}
                value={`${formatHoursDecimal(buckets[hover].ms, 2)} h`}
              />
            )}
          </div>

          {/* X labels */}
          <div className="flex gap-[2px] mt-1">
            {buckets.map((b, i) => (
              <div key={b.key} className="flex-1 min-w-0 text-center text-[10px] text-neutral-500 dark:text-neutral-400 overflow-visible whitespace-nowrap">
                {i % labelEvery === 0 ? b.tick : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

function formatTick(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function Tooltip({
  leftPct,
  bottomPx,
  title,
  value,
}: {
  leftPct: number;
  bottomPx: number;
  title: string;
  value: string;
}) {
  return (
    <div
      className="absolute -translate-x-1/2 pointer-events-none z-10 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md px-2 py-1 whitespace-nowrap"
      style={{ left: `${Math.min(92, Math.max(8, leftPct))}%`, bottom: bottomPx }}
    >
      <div className="text-[10px] text-neutral-500 dark:text-neutral-400">{title}</div>
      <div className="text-xs font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{value}</div>
    </div>
  );
}

// ----- Breakdown --------------------------------------------------------------

const DIMS: Dim[] = ['project', 'client', 'task', 'user'];

function Breakdown({ rows, defaultDim }: { rows: ReportRow[]; defaultDim: Dim }) {
  const t = useT();
  const [picked, setPicked] = useState<Dim | null>(null);
  const dim = picked ?? defaultDim;

  const { items, totalMs } = useMemo(() => {
    const byKey = new Map<string, { label: string; sub: string; ms: number }>();
    let totalMs = 0;
    for (const r of rows) {
      totalMs += r.durationMs;
      const [key, label, sub] =
        dim === 'project'
          ? [`${r.client}|${r.project}`, r.project || '—', r.client]
          : dim === 'client'
            ? [r.client, r.client || t('tracker.noClient'), '']
            : dim === 'task'
              ? [`${r.project}|${r.task}`, r.task || '—', r.project]
              : [r.user, r.user || '—', ''];
      const cur = byKey.get(key);
      if (cur) cur.ms += r.durationMs;
      else byKey.set(key, { label, sub, ms: r.durationMs });
    }
    const sorted = Array.from(byKey.values()).sort((a, b) => b.ms - a.ms);
    if (sorted.length <= BREAKDOWN_TOP) return { items: sorted, totalMs };
    // Fold the long tail into one row instead of inventing more bars.
    const head = sorted.slice(0, BREAKDOWN_TOP - 1);
    const rest = sorted.slice(BREAKDOWN_TOP - 1);
    head.push({
      label: t('tracker.chart.other', { count: rest.length }),
      sub: '',
      ms: rest.reduce((s, x) => s + x.ms, 0),
    });
    return { items: head, totalMs };
  }, [rows, dim, t]);

  const max = Math.max(1, ...items.map((i) => i.ms));

  return (
    <ChartCard
      title={t('tracker.chart.breakdown')}
      action={
        <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
          {DIMS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPicked(d)}
              className={cn(
                'px-2 h-6 text-[11px] rounded',
                dim === d
                  ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
              )}
            >
              {t(`tracker.chart.by.${d}` as const)}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-2">
        {items.map((it, i) => {
          const pct = totalMs > 0 ? Math.round((it.ms / totalMs) * 100) : 0;
          return (
            <div key={i} title={`${it.sub ? `${it.sub} › ` : ''}${it.label}`} className="group">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="truncate min-w-0 text-neutral-800 dark:text-neutral-100">{it.label}</span>
                {it.sub && (
                  <span className="truncate min-w-0 text-[10px] text-neutral-500 dark:text-neutral-400">{it.sub}</span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-neutral-700 dark:text-neutral-200">
                  {formatHoursDecimal(it.ms, 1)} h
                </span>
                <span className="w-9 shrink-0 text-right tabular-nums text-[10px] text-neutral-500 dark:text-neutral-400">
                  {pct}%
                </span>
              </div>
              <div className="mt-0.5 h-2 rounded-r-[4px] bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                <div
                  className={cn('h-full rounded-r-[4px] group-hover:brightness-110', BAR)}
                  style={{ width: `${Math.max(1, (it.ms / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ----- Shared -----------------------------------------------------------------

function ChartCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <div className="flex items-center gap-2 mb-3 min-h-6">
        <div className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{title}</div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}
