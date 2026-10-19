import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useT } from '@/lib/i18n';
import { LiveTimerCard } from '@/components/tracker/LiveTimerCard';
import { ManualEntryForm } from '@/components/tracker/ManualEntryForm';
import { SessionList } from '@/components/tracker/SessionList';
import { TimeImportDialog } from '@/components/tracker/TimeImportDialog';
import { Button } from '@/components/ui/Button';
import { useActiveTimer } from '@/hooks/useTimeEntries';
import { cn } from '@/lib/utils';
import type { TrackerTarget } from '@/types/db';

type Mode = 'live' | 'manual';

export function TrackerPage() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onReports = path.startsWith('/tracker/reports');

  const [mode, setMode] = useState<Mode>('live');
  // Shared between live + manual so toggling keeps the target and the note.
  const [target, setTarget] = useState<TrackerTarget | null>(null);
  const [notes, setNotes] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // In Live mode the note box is the running entry's note: it takes that note
  // when a timer starts (or when you come to Live while one runs), and empties
  // when the timer stops. Manual mode leaves it alone. Adjusted during render
  // when the entry changes, so typing isn't overwritten by refetches.
  const { data: active } = useActiveTimer();
  const liveEntry = mode === 'live' ? (active?.id ?? null) : undefined;
  // Starts unsynced, so arriving with a timer already running shows its note.
  const [syncedEntry, setSyncedEntry] = useState<string | null | undefined>(undefined);
  if (liveEntry !== syncedEntry) {
    setSyncedEntry(liveEntry);
    if (active && liveEntry) setNotes(active.notes ?? '');
    else if (liveEntry === null && syncedEntry) setNotes('');
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{t('tracker.title')}</h1>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.subtitle')}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={13} />
              {t('tracker.import.open')}
            </Button>
            <PageTabs onReports={onReports} />
          </div>
        </div>
        <TimeImportDialog open={importOpen} onOpenChange={setImportOpen} />

        {/* The Live / Manual switch is the first row inside whichever card shows. */}
        {mode === 'live' ? (
          <LiveTimerCard target={target} setTarget={setTarget} notes={notes} setNotes={setNotes} header={<ModeSwitch mode={mode} setMode={setMode} />} />
        ) : (
          <ManualEntryForm target={target} setTarget={setTarget} notes={notes} setNotes={setNotes} header={<ModeSwitch mode={mode} setMode={setMode} />} />
        )}

        <div className="pt-2">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-2">{t('tracker.sessions')}</h2>
          <SessionList
            // The running timer only shows in Live mode, so switch there to
            // make it obvious the clock started.
            onResumed={(tg) => {
              setTarget(tg);
              setMode('live');
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const t = useT();
  return (
    <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
      {(['live', 'manual'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={cn(
            'px-3 h-7 text-xs rounded',
            mode === m
              ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
          )}
        >
          {t(m === 'live' ? 'tracker.modeLive' : 'tracker.modeManual')}
        </button>
      ))}
    </div>
  );
}

function PageTabs({ onReports }: { onReports: boolean }) {
  const t = useT();
  return (
    <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
      <Link
        to="/tracker"
        className={cn(
          'px-3 h-7 text-xs rounded inline-flex items-center',
          !onReports
            ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
        )}
      >
        {t('tracker.tabTrack')}
      </Link>
      <Link
        to="/tracker/reports"
        className={cn(
          'px-3 h-7 text-xs rounded inline-flex items-center',
          onReports
            ? 'bg-white dark:bg-neutral-900 shadow-sm text-neutral-900 dark:text-neutral-100'
            : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
        )}
      >
        {t('tracker.tabReports')}
      </Link>
    </div>
  );
}
