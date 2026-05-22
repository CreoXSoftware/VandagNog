import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useT } from '@/lib/i18n';
import { LiveTimerCard } from '@/components/tracker/LiveTimerCard';
import { ManualEntryForm } from '@/components/tracker/ManualEntryForm';
import { SessionList } from '@/components/tracker/SessionList';
import { cn } from '@/lib/utils';
import type { TrackerTarget } from '@/types/db';

type Mode = 'live' | 'manual';

export function TrackerPage() {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const onReports = path.startsWith('/tracker/reports');

  const [mode, setMode] = useState<Mode>('live');
  // Shared target between live + manual so toggling preserves selection.
  const [target, setTarget] = useState<TrackerTarget | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{t('tracker.title')}</h1>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('tracker.subtitle')}</div>
          </div>
          <PageTabs onReports={onReports} />
        </div>

        <div className="inline-flex bg-neutral-100 dark:bg-neutral-800 rounded p-0.5">
          {(['live', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
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

        {mode === 'live' ? (
          <LiveTimerCard target={target} setTarget={setTarget} />
        ) : (
          <ManualEntryForm target={target} setTarget={setTarget} />
        )}

        <div className="pt-2">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-2">{t('tracker.sessions')}</h2>
          <SessionList />
        </div>
      </div>
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
