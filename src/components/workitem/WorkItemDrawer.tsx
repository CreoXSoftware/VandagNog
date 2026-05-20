import { useEffect, useRef, useState, useMemo } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DisabledHint } from '@/components/ui/DisabledHint';
import { toDateInput, formatDate } from '@/lib/utils';
import type { Dependency, ProjectMember, WorkItem } from '@/types/db';
import { useUpdateWorkItem, useRescheduleFrom } from '@/hooks/useWorkItems';
import { DependencyEditor } from './DependencyEditor';
import { CommentThread } from './CommentThread';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/Avatar';
import { displayName } from '@/lib/userDisplay';
import { useT } from '@/lib/i18n';
import {
  parseDurationInput,
  workItemDurationLabel,
  endDateFromStartAndDuration,
} from '@/lib/duration';

interface Props {
  workItem: WorkItem;
  allItems: WorkItem[];
  dependencies: Dependency[];
  workingDays: number[];
  members: ProjectMember[];
  canEdit: boolean;
  autoFocusName?: boolean;
  onNameFocused?: () => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

export function WorkItemDrawer({ workItem, allItems, dependencies, workingDays, members, canEdit, autoFocusName, onNameFocused, onClose, onNavigate }: Props) {
  const update = useUpdateWorkItem();
  const reschedule = useRescheduleFrom();
  const [tab, setTab] = useState<'details' | 'comments'>('comments');
  const t = useT();

  const workingSet = useMemo(() => new Set(workingDays), [workingDays]);

  const breadcrumb = useMemo(() => buildBreadcrumb(workItem, allItems), [workItem, allItems]);
  const children = useMemo(() => allItems.filter((i) => i.parent_id === workItem.id), [allItems, workItem.id]);
  const isLeaf = children.length === 0 && workItem.level !== 'epic';
  const canEditDates = canEdit && isLeaf;
  const permReason = !canEdit ? t('workItem.permReason') : null;
  const dateReason = !canEdit
    ? permReason
    : !isLeaf
      ? t('workItem.dateReason')
      : null;

  function patch(patch: Partial<WorkItem>) {
    update.mutate(
      { id: workItem.id, project_id: workItem.project_id, patch },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  function handleDateChange(newStart: string | null, newEnd: string | null) {
    if (!newStart || !newEnd) {
      patch({ start_date: newStart, end_date: newEnd });
      return;
    }
    if (newEnd < newStart) {
      toast.error(t('cascade.endBeforeStart'));
      return;
    }
    reschedule.mutate(
      { project_id: workItem.project_id, work_item_id: workItem.id, new_start: newStart, new_end: newEnd },
      { onError: (e) => toast.error((e as Error).message) },
    );
  }

  function handleDurationChange(workDays: number) {
    if (!workItem.start_date) {
      toast.error(t('cascade.needStartDate'));
      return;
    }
    const newEnd = endDateFromStartAndDuration(workItem.start_date, workDays, workingSet);
    if (!newEnd) return;
    handleDateChange(workItem.start_date, newEnd);
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-xs">
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutral-400 dark:text-neutral-500">›</span>}
              {i < breadcrumb.length - 1 ? (
                <button
                  className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[100px]"
                  onClick={() => onNavigate(b.id)}
                >
                  {b.name}
                </button>
              ) : (
                <span className="truncate max-w-[140px]">{b.name}</span>
              )}
            </span>
          ))}
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Badge kind={workItem.level}>{t(`workItem.level.${workItem.level}`)}</Badge>
          {!isLeaf && workItem.level !== 'epic' && (
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{t('workItem.rollupParent')}</span>
          )}
        </div>

        <DisabledHint disabled={!canEdit} reason={permReason}>
          <NameField
            value={workItem.name}
            disabled={!canEdit}
            autoFocus={autoFocusName}
            onAutoFocused={onNameFocused}
            onSave={(v) => patch({ name: v })}
          />
        </DisabledHint>

        <DisabledHint disabled={!canEdit} reason={permReason}>
          <DescField value={workItem.description ?? ''} disabled={!canEdit} onSave={(v) => patch({ description: v || null })} />
        </DisabledHint>

        <DisabledHint disabled={!canEdit} reason={permReason}>
          <DeliverableField value={workItem.deliverable ?? ''} disabled={!canEdit} onSave={(v) => patch({ deliverable: v || null })} />
        </DisabledHint>

        <div className="grid grid-cols-3 gap-3">
          <Field label={t('workItem.start')}>
            <DisabledHint disabled={!canEditDates} reason={dateReason}>
              <DateField
                value={workItem.start_date}
                disabled={!canEditDates}
                onCommit={(v) => handleDateChange(v, workItem.end_date)}
              />
            </DisabledHint>
          </Field>
          <Field label={t('workItem.end')}>
            <DisabledHint disabled={!canEditDates} reason={dateReason}>
              <DateField
                value={workItem.end_date}
                disabled={!canEditDates}
                onCommit={(v) => handleDateChange(workItem.start_date, v)}
              />
            </DisabledHint>
          </Field>
          <Field label={t('workItem.duration')}>
            <DisabledHint disabled={!canEditDates} reason={dateReason}>
              <DurationField
                start={workItem.start_date}
                end={workItem.end_date}
                workingDays={workingSet}
                disabled={!canEditDates}
                onCommit={handleDurationChange}
              />
            </DisabledHint>
          </Field>
        </div>

        <Field label={t('workItem.assignee')}>
          <div className="flex items-center gap-2">
            {workItem.assignee_id ? (
              <Avatar user={members.find((m) => m.user_id === workItem.assignee_id)} size="sm" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-dashed border-neutral-300 dark:border-neutral-700" />
            )}
            <DisabledHint disabled={!canEdit} reason={permReason} className="flex-1">
              <Select
                disabled={!canEdit}
                value={workItem.assignee_id ?? ''}
                onChange={(e) => patch({ assignee_id: e.target.value || null })}
                className="flex-1"
              >
                <option value="">{t('workItem.unassigned')}</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {displayName(m)}
                  </option>
                ))}
              </Select>
            </DisabledHint>
          </div>
        </Field>

        <Field label={t('workItem.progress', { pct: workItem.progress })}>
          <DisabledHint disabled={!canEditDates} reason={dateReason}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!canEditDates}
              value={workItem.progress}
              onChange={(e) => patch({ progress: Number(e.target.value) })}
              className="w-full disabled:opacity-40"
            />
          </DisabledHint>
        </Field>

        <div className="border-t border-neutral-200 dark:border-neutral-800 -mx-4 px-4 pt-3">
          <SectionHeader>{t('workItem.dependencies')}</SectionHeader>
          <DependencyEditor
            workItem={workItem}
            allItems={allItems}
            dependencies={dependencies}
            canEdit={canEdit}
            onNavigate={onNavigate}
          />
        </div>

        {children.length > 0 && (
          <div className="border-t border-neutral-200 dark:border-neutral-800 -mx-4 px-4 pt-3">
            <SectionHeader>{t('workItem.children', { count: children.length })}</SectionHeader>
            <div className="space-y-1">
              {children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onNavigate(c.id)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-sm"
                >
                  <Badge kind={c.level}>{t(`workItem.level.${c.level}`)}</Badge>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{c.progress}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-neutral-200 dark:border-neutral-800 -mx-4 px-4 pt-3">
          <div className="flex gap-1 mb-2 bg-neutral-100 dark:bg-neutral-800 rounded p-0.5 w-fit text-xs">
            <button
              onClick={() => setTab('details')}
              className={`px-3 h-6 rounded ${tab === 'details' ? 'bg-white dark:bg-neutral-900 shadow-sm' : ''}`}
            >
              {t('workItem.meta')}
            </button>
            <button
              onClick={() => setTab('comments')}
              className={`px-3 h-6 rounded ${tab === 'comments' ? 'bg-white dark:bg-neutral-900 shadow-sm' : ''}`}
            >
              {t('workItem.comments')}
            </button>
          </div>

          {tab === 'details' && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
              <div>{t('workItem.createdAt', { date: formatDate(workItem.created_at) })}</div>
              <div>{t('workItem.updatedAt', { date: formatDate(workItem.updated_at) })}</div>
            </div>
          )}
          {tab === 'comments' && (
            <CommentThread
              workItemId={workItem.id}
              projectId={workItem.project_id}
              members={members}
              canEdit={canEdit}
            />
          )}
        </div>
      </div>
    </Drawer>
  );
}

function DurationField({
  start,
  end,
  workingDays,
  disabled,
  onCommit,
}: {
  start: string | null;
  end: string | null;
  workingDays: Set<number>;
  disabled: boolean;
  onCommit: (workDays: number) => void;
}) {
  const t = useT();
  const display = workItemDurationLabel(start, end, workingDays);
  const [v, setV] = useState(display);
  useEffect(() => setV(display), [display]);

  function commit() {
    if (v.trim() === '' || v === display) {
      setV(display);
      return;
    }
    const parsed = parseDurationInput(v);
    if (parsed === null) {
      toast.error(t('workItem.durationInvalid'));
      setV(display);
      return;
    }
    onCommit(parsed);
  }

  return (
    <Input
      value={v}
      disabled={disabled || !start || !end}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(display);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={t('workItem.durationPlaceholder')}
    />
  );
}

function DateField({
  value,
  disabled,
  onCommit,
}: {
  value: string | null;
  disabled: boolean;
  onCommit: (v: string | null) => void;
}) {
  const display = toDateInput(value);
  const [v, setV] = useState(display);
  useEffect(() => setV(display), [display]);

  function commit() {
    if (v === display) return;
    if (v === '') {
      onCommit(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      setV(display);
      return;
    }
    const d = new Date(v + 'T00:00:00');
    if (isNaN(d.getTime())) {
      setV(display);
      return;
    }
    onCommit(v);
  }

  return (
    <Input
      type="date"
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(display);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide mb-2">{children}</div>;
}

function NameField({
  value,
  disabled,
  autoFocus,
  onAutoFocused,
  onSave,
}: {
  value: string;
  disabled: boolean;
  autoFocus?: boolean;
  onAutoFocused?: () => void;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (autoFocus && !disabled && ref.current) {
      ref.current.focus();
      ref.current.select();
      onAutoFocused?.();
    }
  }, [autoFocus, disabled, onAutoFocused]);
  return (
    <input
      ref={ref}
      className="w-full text-xl font-semibold bg-transparent focus:outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800 rounded px-1 py-0.5 disabled:opacity-60"
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && v.trim() && onSave(v.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function DescField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const t = useT();
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">{t('common.description')}</label>
      <Textarea
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        placeholder={t('workItem.descriptionPlaceholder')}
        rows={3}
      />
    </div>
  );
}

function DeliverableField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const t = useT();
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">{t('workItem.deliverable')}</label>
      <Textarea
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        placeholder={t('workItem.deliverablePlaceholder')}
        rows={2}
      />
    </div>
  );
}

function buildBreadcrumb(item: WorkItem, all: WorkItem[]): WorkItem[] {
  const path: WorkItem[] = [item];
  let current = item;
  while (current.parent_id) {
    const parent = all.find((i) => i.id === current.parent_id);
    if (!parent) break;
    path.unshift(parent);
    current = parent;
  }
  return path;
}
