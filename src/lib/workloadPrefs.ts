// Persisted filter setup for the Workload page, so it survives navigating away
// and back. Same convention as tasksPrefs / projectsPrefs: plain localStorage
// under a `vn.*` key.

const KEY = 'vn.workload.prefs';
// Where "Show guests" lived before the rest of the filters were remembered.
const LEGACY_SHOW_GUESTS_KEY = 'vn.workload.showGuests';

export interface WorkloadPrefs {
  /** Empty = every project. */
  projectIds: string[];
  /** Empty = everyone. */
  personIds: string[];
  showGuests: boolean;
  search: string;
  hideEmpty: boolean;
  overdueOnly: boolean;
  /** Only my own row. */
  onlyMine: boolean;
}

export const DEFAULT_WORKLOAD_PREFS: WorkloadPrefs = {
  projectIds: [],
  personIds: [],
  showGuests: true,
  search: '',
  hideEmpty: true,
  overdueOnly: false,
  onlyMine: false,
};

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function loadWorkloadPrefs(): WorkloadPrefs {
  // Storage can throw or come back empty in a private window or with site data
  // blocked, so every read is defensive and falls back to the defaults.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return {
        ...DEFAULT_WORKLOAD_PREFS,
        showGuests: localStorage.getItem(LEGACY_SHOW_GUESTS_KEY) !== '0',
      };
    }
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      projectIds: strArray(p.projectIds),
      personIds: strArray(p.personIds),
      showGuests: p.showGuests !== false,
      search: typeof p.search === 'string' ? p.search : '',
      hideEmpty: p.hideEmpty !== false,
      overdueOnly: p.overdueOnly === true,
      onlyMine: p.onlyMine === true,
    };
  } catch {
    return DEFAULT_WORKLOAD_PREFS;
  }
}

export function saveWorkloadPrefs(prefs: WorkloadPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the page still works, it just won't remember.
  }
}
