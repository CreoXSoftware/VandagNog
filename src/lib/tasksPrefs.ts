// Persisted setup for the Tasks page, so filters survive navigating away and
// back. Follows the app's existing preference convention: plain localStorage
// under a `vn.*` key (see vn.sidebar.collapsed, vn.lang).

import { isTimeFilter, type TimeFilter } from './tasksFilter';

const KEY = 'vn.tasks.prefs';

export interface TasksPrefs {
  when: TimeFilter;
  /** Empty = every project. */
  projectIds: string[];
  /**
   * null means the filter has never been touched, which the page resolves to
   * "just me". It is deliberately distinct from [], which means "everyone":
   * the current user id only arrives with the query, so the default cannot be
   * baked into the stored value.
   */
  assigneeIds: string[] | null;
  statuses: string[];
  search: string;
  showDone: boolean;
  /** Hide project groups with nothing in the current time scope. */
  hideEmpty: boolean;
  /** Collapsed project groups. */
  collapsed: string[];
}

export const DEFAULT_TASKS_PREFS: TasksPrefs = {
  when: 'today',
  projectIds: [],
  assigneeIds: null,
  statuses: [],
  search: '',
  showDone: false,
  hideEmpty: false,
  collapsed: [],
};

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function loadTasksPrefs(): TasksPrefs {
  // Storage can throw or come back empty in a private window or with site data
  // blocked, so every read is defensive and falls back to the defaults.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TASKS_PREFS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      when: isTimeFilter(p.when) ? p.when : DEFAULT_TASKS_PREFS.when,
      projectIds: strArray(p.projectIds),
      assigneeIds: p.assigneeIds == null ? null : strArray(p.assigneeIds),
      statuses: strArray(p.statuses),
      search: typeof p.search === 'string' ? p.search : '',
      showDone: p.showDone === true,
      hideEmpty: p.hideEmpty === true,
      collapsed: strArray(p.collapsed),
    };
  } catch {
    return DEFAULT_TASKS_PREFS;
  }
}

export function saveTasksPrefs(prefs: TasksPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable — the page still works, it just won't remember.
  }
}
