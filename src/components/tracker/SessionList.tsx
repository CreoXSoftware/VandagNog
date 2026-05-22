import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useDeleteTimeEntry, useMyTimeEntries } from '@/hooks/useTimeEntries';
import { useTrackerCatalog, workItemPath, type TrackerCatalog } from '@/hooks/useTrackerCatalog';
import { durationMs, formatHM, formatWeekLabel, formatDateHuman, weekStartIso, isoDate } from '@/lib/timeFormat';
import type { TimeEntry } from '@/types/db';
import { SessionEditDialog } from './SessionEditDialog';

export function SessionList() {
  const t = useT();
  const { data: catalog } = useTrackerCatalog();
  const { data: entries = [] } = useMyTimeEntries();
  const del = useDeleteTimeEntry();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  // Group: week → day → groupKey → entries
  const tree = useMemo(() => groupEntries(entries), [entries]);

  async function onDelete(e: TimeEntry) {
    if (!confirm(t('tracker.deleteConfirm'))) return;
    try {
      await del.mutateAsync(e.id);
      toast.success(t('tracker.entryDeleted'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (!entries.length) {
    return (
      <div className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-10">
        {t('tracker.noSessions')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tree.map((week) => (
        <WeekBlock
          key={week.weekStart}
          week={week}
          catalog={catalog}
          onEdit={setEditing}
          onDelete={onDelete}
        />
      ))}
      {editing && (
        <SessionEditDialog
          entry={editing}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}
    </div>
  );
}

// ----- Tree types ------------------------------------------------------------

interface GroupNode {
  key: string;
  project_id: string;
  work_item_id: string | null;
  custom_task_text: string | null;
  totalMs: number;
  entries: TimeEntry[];
}

interface DayNode {
  date: string;
  totalMs: number;
  groups: GroupNode[];
}

interface WeekNode {
  weekStart: string;
  totalMs: number;
  days: DayNode[];
}

function groupEntries(entries: TimeEntry[]): WeekNode[] {
  const byWeek = new Map<string, WeekNode>();

  for (const e of entries) {
    if (!e.end_at) continue; // skip running timer
    const start = new Date(e.start_at);
    const dayKey = isoDate(start);
    const weekKey = weekStartIso(start);
    const ms = durationMs(e.start_at, e.end_at);

    let week = byWeek.get(weekKey);
    if (!week) {
      week = { weekStart: weekKey, totalMs: 0, days: [] };
      byWeek.set(weekKey, week);
    }
    week.totalMs += ms;

    let day = week.days.find((d) => d.date === dayKey);
    if (!day) {
      day = { date: dayKey, totalMs: 0, groups: [] };
      week.days.push(day);
    }
    day.totalMs += ms;

    const gKey = groupKey(e);
    let g = day.groups.find((x) => x.key === gKey);
    if (!g) {
      g = {
        key: gKey,
        project_id: e.project_id,
        work_item_id: e.work_item_id,
        custom_task_text: e.custom_task_text,
        totalMs: 0,
        entries: [],
      };
      day.groups.push(g);
    }
    g.totalMs += ms;
    g.entries.push(e);
  }

  const weeks = Array.from(byWeek.values()).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  for (const w of weeks) {
    w.days.sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const d of w.days) {
      d.groups.sort((a, b) => b.totalMs - a.totalMs);
      for (const g of d.groups) {
        g.entries.sort((a, b) => (a.start_at < b.start_at ? 1 : -1));
      }
    }
  }
  return weeks;
}

function groupKey(e: TimeEntry): string {
  return `${e.project_id}|${e.work_item_id ?? ''}|${e.custom_task_text ?? ''}`;
}

// ----- Components ------------------------------------------------------------

function WeekBlock({
  week,
  catalog,
  onEdit,
  onDelete,
}: {
  week: WeekNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-50 dark:bg-neutral-900">
        <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
          {formatWeekLabel(week.weekStart)}
        </div>
        <div className="text-sm font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
          {formatHM(week.totalMs)}
        </div>
      </div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {week.days.map((day) => (
          <DayBlock key={day.date} day={day} catalog={catalog} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}

function DayBlock({
  day,
  catalog,
  onEdit,
  onDelete,
}: {
  day: DayNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-sm text-neutral-700 dark:text-neutral-200">{formatDateHuman(day.date + 'T00:00:00')}</span>
        </div>
        <div className="text-sm font-mono tabular-nums text-neutral-600 dark:text-neutral-300">
          {formatHM(day.totalMs)}
        </div>
      </button>
      {open && (
        <div className="bg-neutral-50/50 dark:bg-neutral-900/40">
          {day.groups.map((g) => (
            <GroupBlock key={g.key} group={g} catalog={catalog} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupBlock({
  group,
  catalog,
  onEdit,
  onDelete,
}: {
  group: GroupNode;
  catalog: TrackerCatalog | undefined;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = targetLabel(group.project_id, group.work_item_id, group.custom_task_text, catalog, t);

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <PathLabel parts={label} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{group.entries.length}</span>
          <span className="text-sm font-mono tabular-nums text-neutral-600 dark:text-neutral-300">{formatHM(group.totalMs)}</span>
        </div>
      </button>
      {open && (
        <div className="divide-y divide-neutral-200/70 dark:divide-neutral-800/60">
          {group.entries.map((e) => (
            <EntryRow key={e.id} entry={e} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  onEdit,
  onDelete,
}: {
  entry: TimeEntry;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}) {
  const t = useT();
  const ms = durationMs(entry.start_at, entry.end_at);
  const startTime = new Date(entry.start_at);
  const endTime = entry.end_at ? new Date(entry.end_at) : null;
  return (
    <div className="flex items-center px-3 py-2 gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="text-neutral-700 dark:text-neutral-200">
          {fmtTime(startTime)} – {endTime ? fmtTime(endTime) : t('tracker.running')}
        </div>
        {entry.notes && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">{entry.notes}</div>
        )}
      </div>
      <div className="font-mono tabular-nums text-neutral-600 dark:text-neutral-300">{formatHM(ms)}</div>
      <button
        type="button"
        onClick={() => onEdit(entry)}
        aria-label={t('common.edit')}
        title={t('common.edit')}
        className="p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={() => onDelete(entry)}
        aria-label={t('common.delete')}
        title={t('common.delete')}
        className="p-1 text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function PathLabel({ parts }: { parts: string[] }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span
            className={[
              'truncate',
              i === parts.length - 1 ? 'text-neutral-900 dark:text-neutral-100 font-medium' : 'text-neutral-500 dark:text-neutral-400',
            ].join(' ')}
          >
            {p}
          </span>
          {i < parts.length - 1 && <ChevronRight size={10} className="text-neutral-300 dark:text-neutral-600 shrink-0" />}
        </span>
      ))}
    </div>
  );
}

function targetLabel(
  projectId: string,
  workItemId: string | null,
  customText: string | null,
  catalog: TrackerCatalog | undefined,
  t: (key: never) => string,
): string[] {
  if (!catalog) return ['…'];
  const project = catalog.projects.find((p) => p.id === projectId);
  if (!project) return ['—'];
  // i18n: use literal fallback if t lookup is awkward here
  const noClient = '—';
  const noTask = 'No task';
  const out: string[] = [project.client_name ?? noClient, project.name];
  if (workItemId) {
    out.push(...workItemPath(workItemId, catalog.workItems));
  } else if (customText) {
    out.push(`“${customText}”`);
  } else {
    out.push(noTask);
  }
  void t; // unused parameter to keep API symmetric
  return out;
}
