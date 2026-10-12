import { Fragment } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { CircleHelp } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';
import { useHelp } from '@/lib/helpStore';
import { useT, type TKey } from '@/lib/i18n';
import { isMac, modLabel } from '@/lib/platform';

type PageKey =
  | 'tasks'
  | 'project'
  | 'projects'
  | 'workload'
  | 'tracker'
  | 'clients'
  | 'teams'
  | 'profile'
  | 'general';

type HelpItem =
  | { text: TKey; vars?: Record<string, string | number> }
  | { keys: string[][]; label: TKey };

interface HelpSection {
  title?: TKey;
  items: HelpItem[];
}

const MOD = modLabel;
const CTRL = isMac ? '⌘' : 'Ctrl';

function pageOf(pathname: string): PageKey {
  const p = pathname.replace(/\/+$/, '');
  if (/\/tasks$/.test(p)) return 'tasks';
  if (/\/projects\/[^/]+$/.test(p)) return 'project';
  // "/" redirects to the projects list.
  if (/\/projects$/.test(p) || p === '') return 'projects';
  if (/\/workload$/.test(p)) return 'workload';
  if (/\/tracker(\/reports)?$/.test(p)) return 'tracker';
  if (/\/clients$/.test(p)) return 'clients';
  if (/\/teams(\/[^/]+)?$/.test(p)) return 'teams';
  if (/\/profile$/.test(p)) return 'profile';
  return 'general';
}

// Per-page content. Shortcut rows list alternatives as separate chords, e.g.
// [['Tab'], ['Shift', 'Tab']] renders "Tab / Shift + Tab".
const PAGES: Record<PageKey, { name: TKey; intro: TKey; sections: HelpSection[] }> = {
  tasks: {
    name: 'help.tasks.name',
    intro: 'help.tasks.intro',
    sections: [
      {
        title: 'help.tasks.writeTitle',
        items: [
          { keys: [['Enter']], label: 'help.tasks.kEnter' },
          { keys: [['Tab']], label: 'help.tasks.kTab' },
          { keys: [['Shift', 'Tab']], label: 'help.tasks.kShiftTab' },
          { keys: [['Enter']], label: 'help.tasks.kEmptyEnter' },
          { keys: [['Esc']], label: 'help.tasks.kEsc' },
          { keys: [['↑'], ['↓']], label: 'help.tasks.kArrows' },
          { keys: [['Alt', 'Shift', '↑'], ['Alt', 'Shift', '↓']], label: 'help.tasks.kMove' },
        ],
      },
      {
        title: 'help.tasks.quickTitle',
        items: [
          { keys: [[MOD, 'D']], label: 'help.tasks.kDesc' },
          { keys: [[MOD, 'A']], label: 'help.tasks.kAssign' },
          { keys: [[MOD, 'T']], label: 'help.tasks.kDuration' },
          { text: 'help.tasks.quickNote' },
          ...(isMac ? [{ text: 'help.macNote' as TKey }] : []),
        ],
      },
      {
        title: 'help.tasks.organiseTitle',
        items: [
          { text: 'help.tasks.rename' },
          { text: 'help.tasks.drag' },
          { text: 'help.tasks.summary' },
          { text: 'help.tasks.filters' },
          { text: 'help.tasks.details' },
        ],
      },
      {
        title: 'help.tasks.binTitle',
        items: [{ text: 'help.tasks.bin' }],
      },
    ],
  },
  project: {
    name: 'help.project.name',
    intro: 'help.project.intro',
    sections: [
      {
        title: 'help.project.ganttTitle',
        items: [
          { text: 'help.project.bars' },
          { text: 'help.project.deps' },
          { text: 'help.project.rows' },
          { keys: [['Tab'], ['Shift', 'Tab']], label: 'help.project.kTab' },
          { keys: [[CTRL, 'scroll']], label: 'help.project.kZoom' },
          { keys: [['Shift', 'scroll']], label: 'help.project.kPan' },
        ],
      },
      { title: 'help.project.calTitle', items: [{ text: 'help.project.cal' }] },
      { title: 'help.project.membersTitle', items: [{ text: 'help.project.members' }] },
    ],
  },
  projects: {
    name: 'help.projects.name',
    intro: 'help.projects.intro',
    sections: [
      {
        items: [
          { text: 'help.projects.create' },
          { text: 'help.projects.open' },
          { text: 'help.projects.client' },
          { text: 'help.projects.filters' },
          { text: 'help.projects.pin' },
          { text: 'help.projects.complete' },
        ],
      },
    ],
  },
  workload: {
    name: 'help.workload.name',
    intro: 'help.workload.intro',
    sections: [
      {
        items: [
          { keys: [[CTRL, 'scroll']], label: 'help.workload.kZoom' },
          { keys: [['Shift', 'scroll']], label: 'help.workload.kPan' },
          { text: 'help.workload.filters' },
          { text: 'help.workload.overdue' },
          { text: 'help.workload.who' },
        ],
      },
    ],
  },
  tracker: {
    name: 'help.tracker.name',
    intro: 'help.tracker.intro',
    sections: [
      {
        items: [
          { text: 'help.tracker.live' },
          { text: 'help.tracker.manual' },
          { text: 'help.tracker.edit' },
          { text: 'help.tracker.reports' },
          { text: 'help.tracker.import' },
        ],
      },
    ],
  },
  clients: {
    name: 'help.clients.name',
    intro: 'help.clients.intro',
    sections: [{ items: [{ text: 'help.clients.scope' }, { text: 'help.clients.delete' }] }],
  },
  teams: {
    name: 'help.teams.name',
    intro: 'help.teams.intro',
    sections: [{ items: [{ text: 'help.teams.join' }, { text: 'help.teams.add' }] }],
  },
  profile: {
    name: 'help.profile.name',
    intro: 'help.profile.intro',
    sections: [],
  },
  general: {
    name: 'help.general.name',
    intro: 'help.general.intro',
    sections: [],
  },
};

// The "?" in the header: a tooltip on hover, a modal on click, with the help
// for whichever page is open.
export function HelpButton() {
  const t = useT();
  const { open, setOpen } = useHelp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const page = PAGES[pageOf(pathname)];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('help.button')}
            className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          >
            <CircleHelp size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t('help.tooltip', { page: t(page.name) })}
        </TooltipContent>
      </Tooltip>

      <DialogContent title={t('help.title', { page: t(page.name) })} className="w-[600px]">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(page.intro)}</p>

        {page.sections.map((s, i) => (
          <section key={i} className="mt-4">
            {s.title && (
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
                {t(s.title)}
              </h3>
            )}
            <ul className="space-y-1.5">
              {s.items.map((it, j) =>
                'keys' in it ? (
                  <li key={j} className="flex items-baseline gap-3 text-sm">
                    <span className="shrink-0 w-44 flex flex-wrap items-center gap-1">
                      {it.keys.map((chord, k) => (
                        <Fragment key={k}>
                          {k > 0 && <span className="text-neutral-400 text-xs">/</span>}
                          {chord.map((key, m) => (
                            <Fragment key={m}>
                              {m > 0 && <span className="text-neutral-400 text-xs">+</span>}
                              <Kbd>{key}</Kbd>
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </span>
                    <span className="text-neutral-700 dark:text-neutral-200">{t(it.label)}</span>
                  </li>
                ) : (
                  <li
                    key={j}
                    className="text-sm text-neutral-700 dark:text-neutral-200 pl-3 relative before:content-[''] before:absolute before:left-0 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-neutral-400"
                  >
                    {t(it.text, it.vars)}
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}

        <section className="mt-5 pt-3 border-t border-neutral-200 dark:border-neutral-800">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
            {t('help.general.title')}
          </h3>
          <ul className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
            <li>{t('help.general.sidebar')}</li>
            <li>{t('help.general.bell')}</li>
            <li>{t('help.general.lang')}</li>
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center h-5 min-w-5 justify-center px-1.5 rounded border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 text-[11px] font-mono text-neutral-700 dark:text-neutral-200 shadow-[0_1px_0_rgba(0,0,0,0.08)]">
      {children}
    </kbd>
  );
}
