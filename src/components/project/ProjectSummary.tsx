import { useMemo } from 'react';
import { CalendarRange, Clock, ListChecks, BarChart3, Users, CalendarOff } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import type { NonWorkingDay, ProjectMember, WorkItem } from '@/types/db';
import {
  buildCalendar,
  countWorkingDays,
  diffDays,
  parseDate,
} from '@/components/gantt/ganttUtils';
import { useI18n, useT } from '@/lib/i18n';

interface Props {
  workItems: WorkItem[];
  workingDays: number[];
  nonWorkingDays: NonWorkingDay[];
  members: ProjectMember[];
}

export function ProjectSummary({ workItems, workingDays, nonWorkingDays, members }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'af' ? 'af-ZA' : 'en-US';
  const calendar = useMemo(
    () => buildCalendar(workingDays, nonWorkingDays),
    [workingDays, nonWorkingDays],
  );

  const stats = useMemo(() => {
    let minStart: string | null = null;
    let maxEnd: string | null = null;
    let roots = 0;
    let leaves = 0;
    let maxDepth = 0;
    let weightSum = 0;
    let weightedProgress = 0;

    const byParent = new Map<string | null, WorkItem[]>();
    for (const w of workItems) {
      if (!byParent.has(w.parent_id)) byParent.set(w.parent_id, []);
      byParent.get(w.parent_id)!.push(w);
    }
    function isLeaf(w: WorkItem): boolean {
      return !(byParent.get(w.id)?.length);
    }

    for (const w of workItems) {
      if (w.parent_id === null) roots++;
      if (w.level > maxDepth) maxDepth = w.level;
      if (w.start_date && (!minStart || w.start_date < minStart)) minStart = w.start_date;
      if (w.end_date && (!maxEnd || w.end_date > maxEnd)) maxEnd = w.end_date;
      if (isLeaf(w)) {
        leaves++;
        const s = parseDate(w.start_date);
        const e = parseDate(w.end_date);
        const weight = s && e ? Math.max(diffDays(e, s) + 1, 1) : 1;
        weightSum += weight;
        weightedProgress += weight * w.progress;
      }
    }

    const s = parseDate(minStart);
    const e = parseDate(maxEnd);
    const calDays = s && e ? diffDays(e, s) + 1 : 0;
    const workDays = s && e ? countWorkingDays(s, e, calendar) : 0;

    let holidaysInRange = 0;
    if (s && e) {
      for (const d of calendar.nonWorking) {
        if (d >= (minStart as string) && d <= (maxEnd as string)) holidaysInRange++;
      }
    }

    const progress = weightSum > 0 ? Math.round(weightedProgress / weightSum) : 0;

    return {
      start: minStart,
      end: maxEnd,
      calDays,
      workDays,
      roots,
      leaves,
      maxDepth,
      total: workItems.length,
      progress,
      holidaysInRange,
      holidaysTotal: calendar.nonWorking.size,
    };
  }, [workItems, calendar]);

  function fmt(s: string | null): string {
    const d = parseDate(s);
    if (!d) return '—';
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const dateRangeShort =
    stats.start && stats.end
      ? `${fmt(stats.start)} – ${fmt(stats.end)}`
      : t('summary.noDatesShort');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="hidden lg:flex items-center gap-3 text-[11px] text-neutral-600 dark:text-neutral-300 cursor-help">
          <Chip icon={<CalendarRange size={12} />} label={dateRangeShort} />
          <Chip icon={<Clock size={12} />} label={t('summary.workDaysShort', { n: stats.workDays })} />
          <Chip icon={<ListChecks size={12} />} label={t('summary.itemsShort', { n: stats.total })} />
          <Chip icon={<BarChart3 size={12} />} label={`${stats.progress}%`} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <div className="text-xs space-y-1.5 p-1">
          <div className="font-semibold mb-1">{t('summary.title')}</div>
          <Row icon={<CalendarRange size={12} />} label={t('summary.timeline')}>
            {stats.start && stats.end ? `${fmt(stats.start)} → ${fmt(stats.end)}` : t('summary.noDates')}
          </Row>
          <Row icon={<Clock size={12} />} label={t('summary.duration')}>
            {stats.start && stats.end
              ? t('summary.durationValue', { cal: stats.calDays, work: stats.workDays })
              : '—'}
          </Row>
          <Row icon={<BarChart3 size={12} />} label={t('summary.progress')}>
            {stats.progress}%
          </Row>
          <Row icon={<ListChecks size={12} />} label={t('summary.items')}>
            {t('summary.itemsBreakdown', {
              total: stats.total,
              roots: stats.roots,
              leaves: stats.leaves,
              depth: stats.maxDepth + 1,
            })}
          </Row>
          <Row icon={<Users size={12} />} label={t('summary.members')}>
            {members.length}
          </Row>
          <Row icon={<CalendarOff size={12} />} label={t('summary.nonWorking')}>
            {t('summary.nonWorkingValue', {
              inRange: stats.holidaysInRange,
              total: stats.holidaysTotal,
            })}
          </Row>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1 px-1.5 h-6 rounded bg-neutral-100 dark:bg-neutral-800 tabular-nums whitespace-nowrap">
      <span className="text-neutral-500 dark:text-neutral-400">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-neutral-400 dark:text-neutral-500 mt-0.5">{icon}</span>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
        <div className="tabular-nums">{children}</div>
      </div>
    </div>
  );
}
