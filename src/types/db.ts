export type WorkItemLevel = number;
export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';
export type ProjectRole = 'owner' | 'editor' | 'viewer';
/** guest < member < admin < owner. Guests only see projects shared with them. */
export type OrgRole = 'owner' | 'admin' | 'member' | 'guest';

/** An organization I belong to (my_orgs_list). */
export interface Organization {
  id: string;
  name: string;
  description: string | null;
  is_personal: boolean;
  my_role: OrgRole;
  /** Only for owners/admins of a shared (non-personal) org. */
  invite_code: string | null;
  /** Owners, admins and members. */
  member_count: number;
  guest_count: number;
  /** Projects in the org that I can see. */
  project_count: number;
  created_at: string;
}

/** A person in an org (org_members_list). */
export interface OrgMember {
  user_id: string;
  role: OrgRole;
  joined_at: string;
  email?: string;
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  /** Their own project roles in this org — for a guest, exactly what they can see. */
  projects: { id: string; name: string; role: ProjectRole }[];
}

/** Effective access of one person to one project in an org (org_project_members). */
export interface OrgProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  direct_role: ProjectRole | null;
  org_role: OrgRole | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  working_days: number[];
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by?: string | null;
  client_id: string | null;
  /** Set when the project is marked completed; null while active. */
  completed_at?: string | null;
  completed_by?: string | null;
}

/** My own pin / hide state for one project (project_user_prefs). */
export interface ProjectUserPref {
  project_id: string;
  pinned_at: string | null;
  hidden_at: string | null;
}

export interface Client {
  id: string;
  org_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectClientInfo {
  project_id: string;
  client_id: string;
  client_name: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  joined_at: string;
  email?: string;
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  // From project_members_list: `role` is the effective role. direct_role is the
  // person's own project_members row (null when access comes only from the org);
  // org_role is their role in the project's organization.
  direct_role?: ProjectRole | null;
  org_role?: OrgRole | null;
}

// A deleted project the caller owns (deleted_projects_list).
export interface DeletedProject {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
}

export interface ProjectInvite {
  id: string;
  project_id: string;
  email: string;
  role: ProjectRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface WorkItem {
  id: string;
  project_id: string;
  parent_id: string | null;
  level: WorkItemLevel;
  name: string;
  description: string | null;
  deliverable: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  // Committed range of a parent (both or neither). Its start_date/end_date are
  // the envelope of this range and its children; null = fit to sub-tasks.
  planned_start: string | null;
  planned_end: string | null;
  progress: number;
  assignee_id: string | null;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NonWorkingDay {
  id: string;
  project_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface Dependency {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  type: DependencyType;
  lag_days: number;
  created_at: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  project_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface WorkItemAttachment {
  id: string;
  work_item_id: string;
  project_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export type NotificationEvent =
  | 'assigned'
  | 'mentioned_in_comment'
  | 'comment_on_assigned_item'
  | 'invited'
  | 'predecessor_moved'
  | 'assigned_item_deleted';

export interface NotificationPayload {
  name?: string;
  level?: number;
  comment_id?: string;
  predecessor_id?: string;
  predecessor_name?: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  project_id: string | null;
  actor_id: string | null;
  event_type: NotificationEvent;
  entity_id: string | null;
  payload: NotificationPayload;
  read_at: string | null;
  created_at: string;
  project?: { name: string } | null;
  actor?: { first_name: string | null; last_name: string | null } | null;
}

export interface AuditLogEntry {
  id: number;
  project_id: string;
  actor_id: string;
  entity_type: 'work_item' | 'dependency' | 'project_member' | 'project_team';
  entity_id: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}

export interface UserSettings {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  notifications_enabled: boolean;
  /** The organization picked in the top bar. */
  current_org_id: string | null;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  project_id: string;
  work_item_id: string | null;
  custom_task_text: string | null;
  notes: string | null;
  start_at: string;
  end_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TrackerTaskMode = 'none' | 'workItem' | 'custom';

export interface TrackerTarget {
  project_id: string;
  work_item_id: string | null;
  custom_task_text: string | null;
}

export interface TrackerTargetLabel extends TrackerTarget {
  client_name: string | null;
  project_name: string;
  work_item_path: string[] | null;
}
