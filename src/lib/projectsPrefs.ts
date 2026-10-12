// Persisted filter setup for the Projects page, so it survives navigating into
// a project and back. Same convention as tasksPrefs: plain localStorage under a
// `vn.*` key. Pins and hidden projects are NOT here — those live in the
// project_user_prefs table so they follow you between devices.

const KEY = 'vn.projects.prefs';

export type ProjectStatusFilter = 'active' | 'completed' | 'all';
export const PROJECT_STATUS_FILTERS: ProjectStatusFilter[] = ['active', 'completed', 'all'];

export type ProjectSort = 'name_asc' | 'name_desc' | 'activity' | 'created_desc' | 'created_asc' | 'finish';
export const PROJECT_SORTS: ProjectSort[] = [
  'name_asc',
  'name_desc',
  'activity',
  'created_desc',
  'created_asc',
  'finish',
];

// Client-filter id for projects without a client.
export const NO_CLIENT = '__none__';

export interface ProjectsPrefs {
  status: ProjectStatusFilter;
  search: string;
  /** Empty = anyone. A project matches if any selected person is a member. */
  memberIds: string[];
  /** Empty = any client. Client ids, plus NO_CLIENT for projects without one. */
  clientIds: string[];
  /** Only projects with at least one task assigned to me. */
  mineOnly: boolean;
  showHidden: boolean;
  sort: ProjectSort;
  /** List unpinned projects under a heading per client. */
  groupByClient: boolean;
}

export const DEFAULT_PROJECTS_PREFS: ProjectsPrefs = {
  status: 'active',
  search: '',
  memberIds: [],
  clientIds: [],
  mineOnly: false,
  showHidden: false,
  sort: 'name_asc',
  groupByClient: false,
};

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function loadProjectsPrefs(): ProjectsPrefs {
  // Storage can throw or come back empty in a private window or with site data
  // blocked, so every read is defensive and falls back to the defaults.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROJECTS_PREFS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      status: PROJECT_STATUS_FILTERS.includes(p.status as ProjectStatusFilter)
        ? (p.status as ProjectStatusFilter)
        : DEFAULT_PROJECTS_PREFS.status,
      search: typeof p.search === 'string' ? p.search : '',
      memberIds: strArray(p.memberIds),
      clientIds: strArray(p.clientIds),
      mineOnly: p.mineOnly === true,
      showHidden: p.showHidden === true,
      sort: PROJECT_SORTS.includes(p.sort as ProjectSort)
        ? (p.sort as ProjectSort)
        : DEFAULT_PROJECTS_PREFS.sort,
      groupByClient: p.groupByClient === true,
    };
  } catch {
    return DEFAULT_PROJECTS_PREFS;
  }
}

export function saveProjectsPrefs(prefs: ProjectsPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the page still works, it just won't remember.
  }
}
