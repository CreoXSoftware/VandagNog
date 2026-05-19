# Task Planner — Product Requirements Document

**Version:** 1.0 (MVP)
**Date:** 2026-05-18
**Owner:** nelis@creox.co.za

---

## 1. Summary

Collaborative project planner with a 3-level work hierarchy (Epic → Task → Subtask), dependency-driven scheduling, and a Gantt view that all users see update live. Auth via Supabase magic-link. Per-project membership with 3 roles.

## 2. Goals

- Plan multi-stage projects with hierarchical breakdown and time-based dependencies.
- Multiple users collaborate on a project plan with live-syncing edits (sub-second propagation).
- Automatic schedule recalculation when a predecessor's dates shift.
- Single-page experience: clicking a work item opens an editable detail panel rather than navigating away.

## 3. Non-Goals (v1)

- Time tracking, timesheets, billing.
- Native mobile apps; offline-first.
- Resource leveling / capacity planning.
- File attachments (v2).
- Email notifications of any kind beyond auth magic-links (v2).
- Critical-path highlighting, baselines, MS Project export (v2).
- SSO/SAML, password login.

## 4. User Roles

| Role | Capability |
|---|---|
| **Owner** | Full control: project settings, member invites, role changes, project delete. Multiple owners per project allowed. |
| **Editor** | CRUD on work items, dependencies, comments. Cannot invite or change roles. |
| **Viewer** | Read-only across the project, including comments. |

## 5. Tech Stack

**Frontend**
- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Router (file-based, type-safe; search params for deep-links)
- TanStack Query (server cache; integrates with Realtime invalidation)
- Zustand (local UI state: drawer open, selected item)
- Custom-built Gantt component (~400 LOC, pure React + SVG for dep arrows, no licensed dependency)
- `react-markdown` for comment rendering

**Backend**
- Supabase: Postgres, Auth (magic-link), Realtime, Storage (deferred), Edge Functions (deferred)
- Postgres triggers + PL/pgSQL functions for rollup and dependency rescheduling
- pg_cron for audit prune + soft-delete purge

**Deploy**
- Static frontend: Vercel / Netlify / Cloudflare Pages
- Backend: Supabase managed (Pro tier in prod)

---

## 6. Data Model

### 6.1 Tables

```sql
-- Users come from auth.users (Supabase managed)

projects (
  id uuid pk default gen_random_uuid(),
  name text not null,
  description text,
  working_days int[] not null default '{1,2,3,4,5}', -- ISO dow, 1=Mon
  created_by uuid references auth.users not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz -- grace-period delete
)

project_members (
  project_id uuid references projects on delete cascade,
  user_id uuid references auth.users,
  role text check (role in ('owner','editor','viewer')) not null,
  joined_at timestamptz default now(),
  primary key (project_id, user_id)
)

project_invites (
  id uuid pk default gen_random_uuid(),
  project_id uuid references projects on delete cascade,
  email citext not null,
  role text check (role in ('owner','editor','viewer')) not null,
  invited_by uuid references auth.users,
  token text unique not null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz default now(),
  unique (project_id, email)
)

work_items (
  id uuid pk default gen_random_uuid(),
  project_id uuid references projects on delete cascade not null,
  parent_id uuid references work_items on delete cascade,
  level text check (level in ('epic','task','subtask')) not null,
  name text not null,
  description text, -- markdown
  start_date date,
  end_date date,
  progress int check (progress between 0 and 100) default 0,
  assignee_id uuid references auth.users, -- must be project member (enforced by trigger)
  position int not null default 0, -- sibling ordering
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  -- Hierarchy invariant enforced by trigger:
  --   epic    => parent_id IS NULL
  --   task    => parent.level = 'epic'
  --   subtask => parent.level = 'task'
  -- Date invariant: end_date >= start_date
  check (end_date is null or start_date is null or end_date >= start_date)
)

dependencies (
  id uuid pk default gen_random_uuid(),
  project_id uuid not null, -- denormalized for RLS + channel filtering
  predecessor_id uuid references work_items on delete cascade not null,
  successor_id uuid references work_items on delete cascade not null,
  type text check (type in ('FS','FF','SS','SF')) not null default 'FS',
  lag_days int not null default 0, -- negative = lead
  created_at timestamptz default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
  -- Trigger blocks: predecessor or successor of level 'epic'
  -- Trigger blocks: cycles (recursive CTE check on insert/update)
)

comments (
  id uuid pk default gen_random_uuid(),
  work_item_id uuid references work_items on delete cascade not null,
  project_id uuid not null, -- denormalized
  author_id uuid references auth.users not null,
  parent_comment_id uuid references comments on delete cascade, -- 1-level reply only (trigger enforces)
  body text not null, -- markdown; @[Name](user_id) for mentions
  created_at timestamptz default now(),
  edited_at timestamptz,
  deleted_at timestamptz
)

notifications (
  id uuid pk default gen_random_uuid(),
  user_id uuid references auth.users not null,
  project_id uuid references projects on delete cascade,
  event_type text not null, -- see §10
  entity_id uuid, -- work_item or comment id
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
)

user_settings (
  user_id uuid primary key references auth.users,
  notifications_enabled bool not null default true,
  updated_at timestamptz default now()
)

audit_log (
  id bigserial pk,
  project_id uuid references projects on delete cascade,
  actor_id uuid references auth.users,
  entity_type text not null, -- 'work_item' | 'dependency' | 'project_member'
  entity_id uuid not null,
  action text not null, -- 'create' | 'update' | 'delete' | 'restore'
  before jsonb,
  after jsonb,
  at timestamptz default now()
)
```

### 6.2 Indexes (essential)

- `work_items(project_id) where deleted_at is null`
- `work_items(parent_id)`
- `work_items(assignee_id)`
- `dependencies(predecessor_id)`, `dependencies(successor_id)`, `dependencies(project_id)`
- `comments(work_item_id, created_at)`
- `notifications(user_id, read_at, created_at desc)`
- `audit_log(project_id, at desc)`, `audit_log(entity_id, at desc)`

### 6.3 Realtime publication

- `alter publication supabase_realtime add table work_items, dependencies, comments, notifications, project_members, projects;`
- `alter table <each> replica identity full;` (so deletes carry old row in payload)

---

## 7. Hierarchy & Rollup Behavior

- **Edit rule:** dates and progress are editable **only on leaf items** (subtasks, and tasks with no subtasks). UI disables date pickers + progress slider on parents.
- **Parent dates** = `MIN(child.start_date)` to `MAX(child.end_date)`, recomputed by trigger on child INSERT/UPDATE/DELETE.
- **Parent progress** = `ROUND(SUM(child.duration_days * child.progress) / SUM(child.duration_days))`. Children with NULL dates contribute 0 duration (counted as 0% weight).
- **Implementation:** PL/pgSQL trigger `recompute_parent(work_item_id)` runs AFTER on writes; walks up to epic in one call; updates `updated_at` so realtime broadcasts.
- A task transitions between "leaf" and "parent" automatically when subtasks are added/removed. On the leaf→parent transition, manually-entered dates/progress are recomputed; on parent→leaf the prior manual values are lost (no preservation in MVP).

---

## 8. Dependencies & Scheduling

### 8.1 Rules

- Dependency endpoints must both be `task` or `subtask`. Epics cannot be predecessors or successors (they are rollup-only).
- Cross-hierarchy allowed (subtask in Epic A → task in Epic B is fine).
- Cycles rejected at write time via recursive CTE check in trigger.
- Self-reference rejected by `check (predecessor_id <> successor_id)`.

### 8.2 Dependency types

| Type | Meaning | Constraint on successor |
|---|---|---|
| **FS** | Finish-to-Start (default) | `successor.start_date = predecessor.end_date + lag_days` (next working day) |
| **FF** | Finish-to-Finish | `successor.end_date = predecessor.end_date + lag_days` |
| **SS** | Start-to-Start | `successor.start_date = predecessor.start_date + lag_days` |
| **SF** | Start-to-Finish | `successor.end_date = predecessor.start_date + lag_days` |

Successor preserves its **duration** (`end_date - start_date`) when shifted; the other endpoint moves accordingly.

### 8.3 Scheduling flow (hybrid)

1. User grabs a bar (or its left/right resize handle) in the custom Gantt; the component shows an optimistic preview locally during the drag (no dep cascade is previewed — only the dragged bar moves).
2. On drop, the frontend calls Postgres RPC `reschedule_from(p_work_item_id, p_new_start, p_new_end)`.
3. The RPC, in a single transaction:
   a. Updates the dragged item.
   b. Recursively walks successors via `dependencies`, applying type + `lag_days` + working-days math.
   c. Recomputes parent rollup for each affected branch.
   d. Writes `audit_log` rows for every changed item.
4. Realtime broadcasts row changes to every subscriber on the project's channel; all clients including the dragger reconcile against TanStack Query cache. Dep arrows on the Gantt redraw automatically from the updated data.

### 8.4 Working-days math

- Postgres helper `add_working_days(d date, n int, working_days int[]) returns date`.
- Lag days are interpreted as working days.
- Calendar configured per-project; default `{1,2,3,4,5}` (Mon–Fri).
- Holidays not supported v1.

---

## 9. Realtime Sync

- **One channel per open project:** `project:<uuid>`.
- Subscribes to Postgres Changes filtered on `project_id` for `work_items`, `dependencies`, `comments`, `project_members`, `projects`.
- Subscribes to user-scoped channel for `notifications`.
- **Conflict policy:** last-write-wins at row level. Optimistic UI via TanStack Query mutations; on Realtime echo, cache reconciles. Description and comment bodies are textareas with explicit save (Cmd+Enter); no collaborative typing.
- **Soft conflict detection:** mutation includes `updated_at` known to client; RPC throws `409` if DB row newer → toast "This item changed elsewhere — refreshed".

---

## 10. Notifications (in-app only)

Events recorded into `notifications` table by triggers / RPCs:

1. `assigned` — user set as assignee.
2. `mentioned_in_comment` — `@[Name](user_id)` parsed in comment body.
3. `comment_on_assigned_item` — new comment on an item where I am the assignee (excluding my own comments).
4. `invited` — invite sent to user's email (created on signup match if pre-existing user).
5. `predecessor_moved` — an item whose successor I am assigned to had its dates shifted.
6. `assigned_item_deleted` — item I was assigned to is soft-deleted.

**UI:** bell icon in header, dropdown shows last 30, unread badge, click marks read. `notifications_enabled` user setting toggles all-or-nothing.

---

## 11. Detail Drawer

- Triggered by clicking any work_item row in tree, Gantt bar, or breadcrumb.
- **Width:** 480px overlay anchored right; semi-modal (page interactive behind, no backdrop dim).
- **Close:** click-outside, ESC, or X. Browser back closes if drawer was deep-link entry.
- **URL state:** `?item=<uuid>` synced via TanStack Router `useSearch`; refresh re-opens drawer.
- **No stacking:** clicking a related item replaces drawer content; in-drawer "back" arrow returns to previous if history exists.
- **Inline edit:** all fields edit on click. Save on blur or Enter. Optimistic UI.

### Drawer contents (top to bottom)

1. Breadcrumb: `Epic › Task › Subtask` (clickable to navigate)
2. Level badge + name (h1, click to rename)
3. Description (markdown editor, expand/collapse, Cmd+Enter to save)
4. Meta row: start_date, end_date, duration (auto), assignee dropdown, progress slider (leaf-only; disabled with tooltip otherwise)
5. Children list (collapsible; "+ Add child" inline; click child to drill)
6. Predecessors section (list with type + lag; "+ Add" opens combobox of project items)
7. Successors section (same shape)
8. Activity tab (audit_log entries for this entity, paginated)
9. Comments thread (flat list with optional 1-level reply; @mention autocomplete from members; markdown render)
10. Footer meta: created by / at, updated at

---

## 12. Gantt View (custom implementation)

Lightweight, pure-React + SVG Gantt. No commercial library. Implementation lives under [task-planner/src/components/gantt/](task-planner/src/components/gantt/).

**Layout**
- Two-pane: fixed 280px tree column on the left, horizontally scrolling timeline on the right.
- Day grid: each day = 28px column. Row height = 32px. Header = 56px (month label row + day-number row).
- Date range = `[min(start_date) − 7 days, max(end_date) + 14 days]`; falls back to `today ± a month` if no items have dates yet.
- Today indicated by a vertical red line; weekend columns shaded; the timeline auto-centers on today on mount.

**Tree column**
- Hierarchical rows with chevron expand/collapse, indented by level. Defaults: epics + tasks expanded, subtasks collapsed.
- Toolbar buttons: Expand all / Collapse all.
- Click a row → opens detail drawer (URL `?item=<uuid>`).

**Bars**
- Each work item with both `start_date` and `end_date` is drawn as a positioned `<div>`.
- Bar width = `(duration days) × 28px`; left offset = `(start − rangeStart) × 28px`.
- Progress is rendered as a darker fill from the left of the bar (`width: progress%`).
- Rollup parents (epics, and tasks that have subtasks) render in dark neutral and are **not draggable** — they reflect rollup state from children.
- Leaf items render in blue; draggable when caller has edit permission.

**Drag interactions** (pointer events; works with mouse + touch + pen)
- **Move**: `pointerdown` on bar body → captures origin → `pointermove` shifts both start and end by `round(Δx / 28)` days → `pointerup` commits.
- **Resize left**: `pointerdown` on the left 6px handle → only start shifts.
- **Resize right**: `pointerdown` on the right 6px handle → only end shifts.
- During drag, only the dragged bar's position changes locally (optimistic). Successor bars do **not** preview the cascade.
- On `pointerup`, the frontend calls `reschedule_from(work_item_id, new_start, new_end)`; the RPC cascades to successors and triggers rollup. Realtime then echoes the final positions and the SVG arrows redraw.
- If the user releases without moving (`Δdays === 0`), no RPC is fired and the bar acts as a click.

**Dependency arrows**
- Single absolutely-positioned `<svg>` overlay covering the timeline body.
- For each dependency, a 3-segment L-path is drawn between predecessor and successor anchor points depending on type:
  - `FS` → predecessor right edge → successor left edge
  - `FF` → predecessor right edge → successor right edge
  - `SS` → predecessor left edge → successor left edge
  - `SF` → predecessor left edge → successor right edge
- A small triangle marker (`<marker id="arrowhead">`) terminates each path at the successor.
- Stroke = neutral 400, width 1.5px. No interaction on arrows in v1 (edit via the drawer's DependencyEditor).

**Performance notes**
- DOM-based rendering is fine up to ~1000 visible rows. For larger projects we'd switch to virtualized rows + canvas timeline, but that's v2.
- Drag updates state on each `pointermove` (16ms cadence); React re-renders only the dragged bar's row.

### Other views (MVP)

- Tree-only view: same hierarchy as the Gantt left pane, no timeline.
- Members view: see §14.
- Project list page after login.

### Other views (MVP)

- Tree/list view: same hierarchy as Gantt left panel, no timeline. Toggle in header.
- Project list page after login.

---

## 13. RLS Policies

Helper: `is_member(project_id uuid, min_role text default 'viewer') returns bool` (security definer).

### Per-table summary

| Table | Read | Write |
|---|---|---|
| `projects` | `is_member(id)` | UPDATE `is_member(id,'editor')` for name/desc; DELETE `is_member(id,'owner')` |
| `project_members` | `is_member(project_id)` | `is_member(project_id,'owner')` for INS/UPD/DEL |
| `project_invites` | `is_member(project_id,'owner')` | `is_member(project_id,'owner')` |
| `work_items` | `is_member(project_id)` | `is_member(project_id,'editor')` |
| `dependencies` | `is_member(project_id)` | `is_member(project_id,'editor')` |
| `comments` | `is_member(project_id)` | INS/UPD `is_member(project_id,'editor') AND author_id = auth.uid()`; DELETE `(is_member AND author_id=auth.uid()) OR is_member(project_id,'owner')` |
| `notifications` | `user_id = auth.uid()` | UPDATE (read_at) `user_id = auth.uid()` |
| `audit_log` | `is_member(project_id)` | (no client writes; triggers only) |
| `user_settings` | `user_id = auth.uid()` | `user_id = auth.uid()` |

Anon role: only `project_invites` SELECT by token (for invite landing page). All other tables fully denied to anon.

---

## 14. Invite & Onboarding Flow

1. Owner enters email + role in project members panel → creates `project_invites` row + sends Supabase magic-link email pointing at `/invite/<token>`.
2. Invitee clicks link:
   - If account exists and signed in → token validated, `project_members` row created, redirect to project.
   - If signed out → magic-link triggers Supabase sign-in/sign-up, then token consumed.
3. Token single-use, expires 14 days, revocable by owner before acceptance.
4. Already-member emails: no-op with toast.

---

## 15. Audit Log & Undo

- Postgres trigger `log_changes()` on `work_items`, `dependencies`, `project_members` writes `audit_log(before, after, actor_id=auth.uid(), action)`.
- **UI:** Activity tab in drawer shows entries for that entity, newest first, paginated 25.
- **Undo:** mutations that delete or bulk-edit return a `correlation_id`; toast "Deleted X — Undo" calls `revert(correlation_id)` RPC within 10s. After 10s, only manual revert via audit log (v2).
- **Retention:** 90 days; pg_cron job `prune_audit_log()` runs daily.

---

## 16. Soft Delete & Restore

- `work_items.deleted_at` set on delete; RLS view filter excludes deleted.
- Trigger cascades soft-delete to all descendants atomically; restore reverses.
- `dependencies` referencing a soft-deleted endpoint are **hard-deleted**. Restore notes lost deps in toast.
- `comments.deleted_at` similar; body rendered as "[deleted]" rather than removed.
- `projects` use hard delete with 7-day grace: `projects.deleted_at` blocks all access; pg_cron purges after 7 days. Owner can restore within window from a recently-deleted projects list.
- Permanent purge of soft-deleted work_items after 30 days via pg_cron.

---

## 17. Performance Targets

- First contentful paint < 1.5s on broadband.
- Drawer open < 100ms (already-loaded data).
- Realtime echo end-to-end < 500ms p95.
- Reschedule RPC for a 500-item project graph < 1s p95.
- Gantt initial render for 1000 work_items < 2s.

---

## 18. Open Questions / Risks

- Custom Gantt is DOM-based; tested fine up to ~1000 visible rows. Beyond that, switch to virtualized rows + canvas timeline (v2).
- Recursive PL/pgSQL reschedule on pathological graphs (long dep chains) needs depth guard (e.g. max 1000 hops, transaction abort with friendly error).
- LWW conflict on simultaneous drag of overlapping dependency chains: deferred — accept "last save wins" until users complain.
- Realtime free-tier 200 concurrent conns sufficient for early users; monitor and upgrade to Pro before launch.

---

## 19. Milestones (suggested)

| Milestone | Scope |
|---|---|
| **M1** — Skeleton | Vite app, Supabase project, magic-link auth, project create/list, RLS scaffold |
| **M2** — Hierarchy CRUD | work_items table, tree view, drawer with inline edit (no Gantt yet) |
| **M3** — Members & invites | project_members, project_invites, role enforcement |
| **M4** — Dependencies & scheduling | dependencies table, reschedule RPC, working-days math |
| **M5** — Gantt | Custom Gantt component, draggable bars + resize handles, SVG dep arrows, parent rollup verified |
| **M6** — Comments + notifications | Comments thread, @mentions, in-app notifications, bell |
| **M7** — Realtime | Channels, optimistic UI reconciliation, conflict toast |
| **M8** — Audit + undo + soft delete | Triggers, activity tab, toast undo, restore UI |
| **M9** — Polish & launch | Performance pass, error states, onboarding empty states |

---

## 20. Out of Scope (v2+ Roadmap)

Email notifications • file attachments • multi-assignee/watchers • holiday calendar • per-user working hours • separate status enum • full undo stack • project-wide activity feed • custom fields • saved filters • mobile UI • critical-path highlighting • baselines • exports (CSV / MSP / PDF) • resource leveling • API/webhooks • SSO/SAML • password login.
