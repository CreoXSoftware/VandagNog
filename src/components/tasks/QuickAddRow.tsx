import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useCreateWorkItem } from '@/hooks/useWorkItems';
import {
  parseDate,
  snapBackward,
  snapForward,
  toDateString,
  type WorkCalendar,
} from '@/components/gantt/ganttUtils';
import { seedDatesFor, type TimeFilter } from '@/lib/tasksFilter';

interface Props {
  projectId: string;
  /** Existing root-level positions in this project, for the next sort key. */
  rootPositions: number[];
  calendar: WorkCalendar;
  when: TimeFilter;
  today: string;
  /**
   * Who to assign the new task to — the single filtered assignee if there is
   * one, otherwise you. Already checked against the project's membership, since
   * enforce_assignee_membership rejects anyone else.
   */
  assigneeId: string | null;
}

// Inline "add a task" pinned to the bottom of a project group.
//
// Creates at root level (parent_id: null) on purpose: adding a child to a dated
// parent would make the rollup trigger recompute that parent's span from its
// children, which is why GanttView.addChild has to seed dates from siblings.
// A root item has no such interaction.
export function QuickAddRow({
  projectId,
  rootPositions,
  calendar,
  when,
  today,
  assigneeId,
}: Props) {
  const t = useT();
  const create = useCreateWorkItem();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;

    // Seed dates from the active filter so the new row lands in the list you're
    // looking at, then snap to the project calendar — the DB trigger would snap
    // them anyway, and doing it here keeps the optimistic row honest.
    const seed = seedDatesFor(when, today);
    const start = snapIso(seed.start_date, calendar, 'forward');
    let end = snapIso(seed.end_date, calendar, 'backward');
    if (start && end && end < start) end = start;

    // Same (index + 1) * 1000 scheme the gantt uses when it renumbers siblings.
    const nextPosition =
      rootPositions.length > 0 ? Math.max(...rootPositions) + 1000 : 1000;

    // Clear the field first: the optimistic row is already in the cache by the
    // time the mutation resolves, so the input should be ready for the next one
    // immediately rather than after the round trip.
    setName('');

    try {
      await create.mutateAsync({
        // Generate the id here so the optimistic row IS the real row.
        id: newId(),
        project_id: projectId,
        parent_id: null,
        name: trimmed,
        start_date: start,
        end_date: end,
        position: nextPosition,
        assignee_id: assigneeId,
      });
      // Deliberately does NOT open the new task: the point of this row is to
      // type several in a row, and a drawer would steal focus every time.
      inputRef.current?.focus();
    } catch (e) {
      // The optimistic row is rolled back by the mutation, so put the text back
      // rather than losing what was typed.
      setName((cur) => cur || trimmed);
      toast.error((e as Error).message || t('tasks.addFailed'));
    }
  }

  return (
    <div className="flex items-center gap-2 pl-3 pr-2 h-9 border-b border-neutral-100 dark:border-neutral-800/60">
      <Plus size={14} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            setName('');
            e.currentTarget.blur();
          }
        }}
        placeholder={t('tasks.addPlaceholder')}
        className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
      />
    </div>
  );
}

// crypto.randomUUID needs a secure context; dev over plain http on a LAN ip is
// not one, so fall back to a v4 built from getRandomValues.
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function snapIso(
  iso: string | null,
  calendar: WorkCalendar,
  dir: 'forward' | 'backward',
): string | null {
  if (!iso) return null;
  const d = parseDate(iso);
  if (!d) return iso;
  return toDateString(dir === 'forward' ? snapForward(d, calendar) : snapBackward(d, calendar));
}
