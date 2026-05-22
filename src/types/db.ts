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
