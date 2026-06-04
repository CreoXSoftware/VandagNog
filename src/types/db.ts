export type WorkItemLevel = number;
export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';
export type ProjectRole = 'owner' | 'editor' | 'viewer';
export type TeamRole = 'owner' | 'member';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  working_days: number[];
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_id: string | null;
}

export type ClientScope = 'private' | 'team';

export interface Client {
  id: string;
  name: string;
  owner_user_id: string | null;
  team_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface VisibleClient {
  id: string;
  name: string;
  scope: ClientScope;
  team_id: string | null;
  team_name: string | null;
}

export interface ProjectClientInfo {
  project_id: string;
  client_id: string;
  client_name: string;
  scope: ClientScope;
  team_id: string | null;
  team_name: string | null;
  owner_user_id: string | null;
  owner_display_name: string | null;
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

export interface Team {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamSummary extends Team {
  my_role: TeamRole;
  member_count: number;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  email?: string;
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
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
  entity_type: 'work_item' | 'dependency' | 'project_member';
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
