import { useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useMyTimeEntries } from '@/hooks/useTimeEntries';
import { useOrgTrackerCatalog, workItemPath, type TrackerCatalog } from '@/hooks/useTrackerCatalog';
import type { TimeEntry, TrackerTarget } from '@/types/db';

export interface NoteSuggestion {
  notes: string;
  target: TrackerTarget;
}

// Fewer letters than this match nearly everything.
const MIN_CHARS = 2;
const MAX_SUGGESTIONS = 6;

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** A past note picked from the list, with the task it was logged to. */
  onPickSuggestion: (s: NoteSuggestion) => void;
  /** Keys the list does not use — Enter with nothing highlighted, for one. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  /** The current target: the note already logged against it isn't offered. */
  target: TrackerTarget | null;
  className?: string;
}

// The tracker's note field. Typing offers earlier notes, newest first, each
// with the client › project › task it was logged to, so picking one fills in
// both. ↓/↑ move through the list and Enter picks; Enter with nothing
// highlighted is left to the form.
export function NoteInput({ value, onChange, onPickSuggestion, onKeyDown, onBlur, target, className }: Props) {
  const t = useT();
  const listId = useId();
  const { data: catalog } = useOrgTrackerCatalog();
  const { data: entries } = useMyTimeEntries();
  const history = useMemo(() => noteHistory(entries, catalog), [entries, catalog]);

  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = useMemo(() => matchNotes(history, q, target), [history, q, target]);
  const shown = open && suggestions.length > 0;
  // Nothing highlighted until ↓, so Enter keeps doing what it did.
  const [cursor, setCursor] = useState({ q: '', i: -1 });
  const active = cursor.q === q ? Math.min(cursor.i, suggestions.length - 1) : -1;

  function pick(s: NoteSuggestion) {
    setOpen(false);
    onPickSuggestion(s);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = suggestions.length;
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault();
      setOpen(true);
      setCursor({ q, i: shown ? (active + 1) % n : 0 });
      return;
    }
    if (shown) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor({ q, i: active <= 0 ? n - 1 : active - 1 });
        return;
      }
      if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        pick(suggestions[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        placeholder={t('tracker.notePlaceholder')}
        aria-label={t('tracker.notesLabel')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
      />
      {shown && catalog && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 max-h-80 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1"
        >
          <div className="px-2.5 pt-0.5 pb-1 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {t('tracker.noteSuggestions')}
          </div>
          {suggestions.map((s, i) => (
            <button
              key={suggestionKey(s)}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              // Keeps focus in the note, so it doesn't blur (and close) first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== active && setCursor({ q, i })}
              onClick={() => pick(s)}
              className={cn(
                'w-full block px-2.5 py-1.5 text-left',
                i === active && 'bg-neutral-100 dark:bg-neutral-800',
              )}
            >
              <div className="text-sm truncate text-neutral-900 dark:text-neutral-100">
                <Highlighted text={s.notes} query={q} />
              </div>
              <div className="text-[11px] truncate text-neutral-500 dark:text-neutral-400">
                {targetPath(s.target, catalog, t('tracker.noTask')).join(' › ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Every distinct note + target you have logged in this organization, newest
// first. Entries on a project or task you can no longer pick are left out.
function noteHistory(entries: TimeEntry[] | undefined, catalog: TrackerCatalog | undefined): NoteSuggestion[] {
  if (!entries || !catalog) return [];
  const projectIds = new Set(catalog.projects.map((p) => p.id));
  const taskIds = new Set(catalog.workItems.map((w) => w.id));
  const seen = new Set<string>();
  const out: NoteSuggestion[] = [];
  for (const e of entries) {
    const notes = e.notes?.trim();
    if (!notes || !projectIds.has(e.project_id)) continue;
    if (e.work_item_id && !taskIds.has(e.work_item_id)) continue;
    const s: NoteSuggestion = {
      notes,
      target: { project_id: e.project_id, work_item_id: e.work_item_id, custom_task_text: e.custom_task_text },
    };
    const k = suggestionKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// Notes holding every typed word. A note that starts with what was typed
// comes first, then one with a word that does, then the rest — each newest
// first.
function matchNotes(history: NoteSuggestion[], q: string, target: TrackerTarget | null): NoteSuggestion[] {
  if (q.length < MIN_CHARS) return [];
  const words = q.split(/\s+/);
  const tiers: NoteSuggestion[][] = [[], [], []];
  for (const s of history) {
    const n = s.notes.toLowerCase();
    if (!words.every((w) => n.includes(w))) continue;
    // What is already in the box, on the task already chosen, is no suggestion.
    if (n === q && target && sameTarget(s.target, target)) continue;
    const at = n.indexOf(q);
    tiers[at === 0 ? 0 : at > 0 && /\s/.test(n[at - 1]) ? 1 : 2].push(s);
    if (tiers[0].length >= MAX_SUGGESTIONS) break;
  }
  return tiers.flat().slice(0, MAX_SUGGESTIONS);
}

function sameTarget(a: TrackerTarget, b: TrackerTarget): boolean {
  return (
    a.project_id === b.project_id &&
    (a.work_item_id ?? null) === (b.work_item_id ?? null) &&
    (a.custom_task_text ?? null) === (b.custom_task_text ?? null)
  );
}

function suggestionKey(s: NoteSuggestion): string {
  const { project_id, work_item_id, custom_task_text } = s.target;
  return `${s.notes.toLowerCase()}|${project_id}|${work_item_id ?? ''}|${custom_task_text ?? ''}`;
}

function targetPath(target: TrackerTarget, catalog: TrackerCatalog, noTask: string): string[] {
  const project = catalog.projects.find((p) => p.id === target.project_id);
  if (!project) return ['—'];
  const out = [project.client_name ?? '—', project.name];
  if (target.work_item_id) out.push(...workItemPath(target.work_item_id, catalog.workItems));
  else if (target.custom_task_text) out.push(`“${target.custom_task_text}”`);
  else out.push(noTask);
  return out;
}

// The typed text in bold where it appears in one piece.
function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}
