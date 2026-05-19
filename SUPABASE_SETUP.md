# Supabase Setup — Task Planner

Everything you need to set up the Supabase project for the Task Planner frontend.

Run all SQL in **Supabase Dashboard → SQL Editor**. The order matters — run each section in sequence. Each section is idempotent where possible (uses `if not exists` / `or replace`).

---

## 0. Create the Supabase project

1. Go to <https://supabase.com> → New project. Pick a region near your users.
2. Copy your **Project URL** and **anon public key** from Project Settings → API.
3. In `task-planner/.env` (copy from `.env.example`):
   ```env
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGc...
   VITE_APP_URL=http://localhost:5173
   VITE_SYNCFUSION_LICENSE_KEY=    # optional, see README
   ```

### 0.1 Auth settings

In **Authentication → Providers → Email**:
- Enable Email provider.
- Enable **Magic Link**.
- Disable password sign-in if you only want magic-link.

In **Authentication → URL Configuration**:
- **Site URL** = `http://localhost:5173` (dev) — change to production URL when you deploy.
- **Redirect URLs** — add:
  - `http://localhost:5173/**`
  - `https://YOUR-PROD-DOMAIN/**`

### 0.2 Required extensions

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
-- pg_cron is enabled on Supabase Pro projects. For Free tier, skip the pg_cron section at the bottom.
create extension if not exists pg_cron;
```

---

## 1. Schema

```sql
-- =====================================================================
-- 1.1 Projects
-- =====================================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  description text,
  working_days int[] not null default '{1,2,3,4,5}',
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index projects_created_by_idx on public.projects(created_by);
create index projects_active_idx on public.projects(id) where deleted_at is null;

-- =====================================================================
-- 1.2 Project members
-- =====================================================================
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members(user_id);

-- =====================================================================
-- 1.3 Project invites
-- =====================================================================
create table public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

-- =====================================================================
-- 1.4 Work items (Epic / Task / Subtask in one table)
-- =====================================================================
create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.work_items(id) on delete cascade,
  level text not null check (level in ('epic','task','subtask')),
  name text not null check (char_length(name) between 1 and 300),
  description text,
  start_date date,
  end_date date,
  progress int not null default 0 check (progress between 0 and 100),
  assignee_id uuid references auth.users(id) on delete set null,
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index work_items_project_idx on public.work_items(project_id) where deleted_at is null;
create index work_items_parent_idx on public.work_items(parent_id);
create index work_items_assignee_idx on public.work_items(assignee_id);

-- =====================================================================
-- 1.5 Dependencies
-- =====================================================================
create table public.dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  predecessor_id uuid not null references public.work_items(id) on delete cascade,
  successor_id uuid not null references public.work_items(id) on delete cascade,
  type text not null default 'FS' check (type in ('FS','FF','SS','SF')),
  lag_days int not null default 0,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

create index deps_pred_idx on public.dependencies(predecessor_id);
create index deps_succ_idx on public.dependencies(successor_id);
create index deps_project_idx on public.dependencies(project_id);

-- =====================================================================
-- 1.6 Comments
-- =====================================================================
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index comments_work_item_idx on public.comments(work_item_id, created_at);

-- =====================================================================
-- 1.7 Notifications
-- =====================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_type text not null check (event_type in (
    'assigned','mentioned_in_comment','comment_on_assigned_item',
    'invited','predecessor_moved','assigned_item_deleted'
  )),
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

-- =====================================================================
-- 1.8 User settings
-- =====================================================================
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  notifications_enabled bool not null default true,
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- 1.9 Audit log
-- =====================================================================
create table public.audit_log (
  id bigserial primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('work_item','dependency','project_member')),
  entity_id uuid not null,
  action text not null check (action in ('create','update','delete','restore')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index audit_project_idx on public.audit_log(project_id, at desc);
create index audit_entity_idx on public.audit_log(entity_id, at desc);
```

---

## 2. Helpers, triggers, and the rollup function

```sql
-- =====================================================================
-- 2.1 updated_at touch helper
-- =====================================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create trigger work_items_touch before update on public.work_items
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- 2.2 Hierarchy invariant
-- =====================================================================
create or replace function public.enforce_hierarchy() returns trigger
language plpgsql as $$
declare
  parent_level text;
begin
  if new.level = 'epic' then
    if new.parent_id is not null then raise exception 'Epics cannot have a parent'; end if;
  elsif new.level = 'task' then
    if new.parent_id is null then raise exception 'Tasks require a parent epic'; end if;
    select level into parent_level from public.work_items where id = new.parent_id;
    if parent_level <> 'epic' then raise exception 'Task parent must be an epic'; end if;
  elsif new.level = 'subtask' then
    if new.parent_id is null then raise exception 'Subtasks require a parent task'; end if;
    select level into parent_level from public.work_items where id = new.parent_id;
    if parent_level <> 'task' then raise exception 'Subtask parent must be a task'; end if;
  end if;
  return new;
end $$;

create trigger work_items_hierarchy
  before insert or update of parent_id, level on public.work_items
  for each row execute function public.enforce_hierarchy();

-- =====================================================================
-- 2.3 Assignee must be a project member
-- =====================================================================
create or replace function public.enforce_assignee_membership() returns trigger
language plpgsql as $$
begin
  if new.assignee_id is null then return new; end if;
  if not exists (
    select 1 from public.project_members
    where project_id = new.project_id and user_id = new.assignee_id
  ) then
    raise exception 'Assignee % is not a member of project %', new.assignee_id, new.project_id;
  end if;
  return new;
end $$;

create trigger work_items_assignee_member
  before insert or update of assignee_id on public.work_items
  for each row execute function public.enforce_assignee_membership();

-- =====================================================================
-- 2.4 Dependencies: only task/subtask, no cycles, same project
-- =====================================================================
create or replace function public.enforce_dependency_rules() returns trigger
language plpgsql as $$
declare
  pred_level text;
  succ_level text;
  pred_project uuid;
  succ_project uuid;
  cyc_found bool;
begin
  select level, project_id into pred_level, pred_project from public.work_items where id = new.predecessor_id;
  select level, project_id into succ_level, succ_project from public.work_items where id = new.successor_id;

  if pred_level not in ('task','subtask') or succ_level not in ('task','subtask') then
    raise exception 'Dependencies must be between tasks/subtasks only';
  end if;
  if pred_project <> succ_project or new.project_id <> pred_project then
    raise exception 'Dependency endpoints must be in the same project';
  end if;

  -- Cycle detection: would adding this edge create a path from successor back to predecessor?
  with recursive walk(node) as (
    select new.successor_id
    union all
    select d.successor_id from public.dependencies d
    join walk w on d.predecessor_id = w.node
  )
  select exists (select 1 from walk where node = new.predecessor_id) into cyc_found;

  if cyc_found then
    raise exception 'Dependency would create a cycle';
  end if;

  return new;
end $$;

create trigger deps_enforce
  before insert or update on public.dependencies
  for each row execute function public.enforce_dependency_rules();

-- =====================================================================
-- 2.5 Working-days math
-- =====================================================================
-- Postgres EXTRACT(dow) returns 0..6 (Sun=0). We use ISO 1..7 in frontend, but
-- we'll normalize: project.working_days holds ISO numbers (Mon=1..Sun=7).
create or replace function public.is_working_day(d date, wd int[]) returns bool
language sql immutable as $$
  select case when extract(dow from d)::int = 0 then 7 else extract(dow from d)::int end = any(wd);
$$;

create or replace function public.add_working_days(d date, n int, wd int[]) returns date
language plpgsql immutable as $$
declare
  step int := case when n >= 0 then 1 else -1 end;
  remaining int := abs(n);
  cur date := d;
begin
  if n = 0 then return d; end if;
  while remaining > 0 loop
    cur := cur + step;
    if public.is_working_day(cur, wd) then
      remaining := remaining - 1;
    end if;
  end loop;
  return cur;
end $$;

-- =====================================================================
-- 2.6 Parent rollup: recompute parent dates+progress when children change
-- =====================================================================
create or replace function public.recompute_parent(p_id uuid) returns void
language plpgsql as $$
declare
  parent uuid;
  new_start date;
  new_end date;
  new_progress int;
begin
  select parent_id into parent from public.work_items where id = p_id;
  while parent is not null loop
    select
      min(start_date),
      max(end_date),
      coalesce(
        round(
          sum(
            greatest(coalesce((end_date - start_date),0) + 1, 0)::numeric * progress
          ) / nullif(sum(greatest(coalesce((end_date - start_date),0) + 1, 0)::numeric), 0),
          0
        )::int,
        0
      )
    into new_start, new_end, new_progress
    from public.work_items
    where parent_id = parent and deleted_at is null;

    update public.work_items
       set start_date = new_start,
           end_date   = new_end,
           progress   = coalesce(new_progress, 0)
     where id = parent
       and ( start_date is distinct from new_start
          or end_date is distinct from new_end
          or progress is distinct from coalesce(new_progress, 0));

    select parent_id into parent from public.work_items where id = parent;
  end loop;
end $$;

create or replace function public.work_items_rollup_trg() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.parent_id is not null then perform public.recompute_parent(old.id); end if;
    return old;
  elsif tg_op = 'INSERT' then
    if new.parent_id is not null then perform public.recompute_parent(new.id); end if;
    return new;
  else
    perform public.recompute_parent(new.id);
    return new;
  end if;
end $$;

create trigger work_items_rollup
  after insert or update of start_date, end_date, progress, parent_id, deleted_at
  or delete on public.work_items
  for each row execute function public.work_items_rollup_trg();
```

---

## 3. Dependency-driven rescheduling RPC

```sql
-- =====================================================================
-- 3.1 reschedule_from
-- Apply a new start/end to a work_item, then propagate to all successors
-- using their dependency type + lag_days + project working calendar.
-- Successors preserve duration; predecessors don't move.
-- =====================================================================
create or replace function public.reschedule_from(
  p_work_item_id uuid,
  p_new_start date,
  p_new_end date
) returns void
language plpgsql security invoker as $$
declare
  wd int[];
  proj uuid;
  prev_start date;
  prev_end date;
  rec record;
  succ_dur int;
  new_succ_start date;
  new_succ_end date;
  before_jsonb jsonb;
begin
  select project_id, working_days(p.project_id), wi.start_date, wi.end_date
    into proj, wd, prev_start, prev_end
  from public.work_items wi
  join public.projects p on p.id = wi.project_id
  where wi.id = p_work_item_id;

  if proj is null then raise exception 'work item % not found', p_work_item_id; end if;

  before_jsonb := to_jsonb((select w from public.work_items w where id = p_work_item_id));

  update public.work_items
     set start_date = p_new_start, end_date = p_new_end
   where id = p_work_item_id;

  insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
    values (
      proj, auth.uid(), 'work_item', p_work_item_id, 'update',
      before_jsonb,
      to_jsonb((select w from public.work_items w where id = p_work_item_id))
    );

  -- BFS over successors with a safety bound to avoid runaway recursion.
  for rec in
    with recursive succ_walk(id, depth) as (
      select d.successor_id, 1
        from public.dependencies d
       where d.predecessor_id = p_work_item_id
      union all
      select d.successor_id, sw.depth + 1
        from public.dependencies d
        join succ_walk sw on d.predecessor_id = sw.id
       where sw.depth < 1000
    )
    select distinct id from succ_walk
  loop
    for rec in
      select d.*, wi.start_date as s_start, wi.end_date as s_end
        from public.dependencies d
        join public.work_items wi on wi.id = d.successor_id
       where d.successor_id = rec.id
       order by d.created_at
       limit 1
    loop
      succ_dur := greatest(coalesce(rec.s_end - rec.s_start, 0), 0);

      if rec.type = 'FS' then
        new_succ_start := public.add_working_days(p_new_end, rec.lag_days + 1, wd);
        new_succ_end   := public.add_working_days(new_succ_start, succ_dur, wd);
      elsif rec.type = 'FF' then
        new_succ_end   := public.add_working_days(p_new_end, rec.lag_days, wd);
        new_succ_start := public.add_working_days(new_succ_end, -succ_dur, wd);
      elsif rec.type = 'SS' then
        new_succ_start := public.add_working_days(p_new_start, rec.lag_days, wd);
        new_succ_end   := public.add_working_days(new_succ_start, succ_dur, wd);
      elsif rec.type = 'SF' then
        new_succ_end   := public.add_working_days(p_new_start, rec.lag_days, wd);
        new_succ_start := public.add_working_days(new_succ_end, -succ_dur, wd);
      end if;

      -- Recurse via update; the trigger fires further successors? We bypass that
      -- by inlining; just write directly. The downstream walk handled the rest.
      update public.work_items
         set start_date = new_succ_start, end_date = new_succ_end
       where id = rec.successor_id
         and (start_date is distinct from new_succ_start or end_date is distinct from new_succ_end);
    end loop;
  end loop;
end $$;

-- Tiny helper to extract working_days for a project (saves a JOIN repeat)
create or replace function public.working_days(p_project_id uuid) returns int[]
language sql stable as $$
  select working_days from public.projects where id = p_project_id;
$$;
```

> **Note**: this is a pragmatic v1. For complex graphs with diamond merges (one successor with multiple predecessors), full PERT scheduling needs constraint propagation. v1 walks per-edge; if you hit edge cases, scope a v1.1 to compute `max(over_all_predecessors)`.

---

## 4. Invite RPCs

```sql
-- =====================================================================
-- 4.1 create_invite — called by owner; returns the token
-- =====================================================================
create or replace function public.create_invite(p_project_id uuid, p_email text, p_role text)
returns json
language plpgsql security invoker as $$
declare
  v_token text;
  v_id uuid;
begin
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only owners can invite';
  end if;

  insert into public.project_invites(project_id, email, role, invited_by)
    values (p_project_id, p_email, p_role, auth.uid())
  on conflict (project_id, email)
    do update set role = excluded.role, expires_at = now() + interval '14 days', accepted_at = null
  returning id, token into v_id, v_token;

  -- Notify if user already exists
  insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
  select u.id, p_project_id, 'invited', v_id, jsonb_build_object('role', p_role, 'email', p_email)
    from auth.users u
   where lower(u.email) = lower(p_email);

  return json_build_object('id', v_id, 'token', v_token);
end $$;

-- =====================================================================
-- 4.2 accept_invite — called by signed-in user with the token
-- =====================================================================
create or replace function public.accept_invite(p_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.project_invites%rowtype;
  v_user_email text;
begin
  select email into v_user_email from auth.users where id = auth.uid();
  if v_user_email is null then raise exception 'Not authenticated'; end if;

  select * into v_inv from public.project_invites
   where token = p_token and accepted_at is null and expires_at > now();

  if v_inv.id is null then raise exception 'Invite invalid or expired'; end if;
  if lower(v_inv.email) <> lower(v_user_email) then
    raise exception 'Invite email does not match your account';
  end if;

  insert into public.project_members(project_id, user_id, role)
    values (v_inv.project_id, auth.uid(), v_inv.role)
  on conflict (project_id, user_id) do update set role = excluded.role;

  update public.project_invites set accepted_at = now() where id = v_inv.id;

  return json_build_object('project_id', v_inv.project_id);
end $$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;
```

### 4.3 create_project — atomic project + first-member insert

The frontend calls this RPC instead of two raw `INSERT`s. This bypasses the
chicken-and-egg between `projects` (whose SELECT policy requires membership)
and `project_members` (the very row that proves membership).

```sql
create or replace function public.create_project(p_name text, p_description text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  v_project public.projects;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.projects(name, description, created_by)
    values (p_name, p_description, auth.uid())
    returning * into v_project;
  insert into public.project_members(project_id, user_id, role)
    values (v_project.id, auth.uid(), 'owner');
  return v_project;
end $$;

revoke all on function public.create_project(text, text) from public;
grant execute on function public.create_project(text, text) to authenticated;
```

---

## 5. Notifications via triggers

```sql
-- 5.1 Assigned
create or replace function public.notify_assigned() returns trigger
language plpgsql as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  then
    insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
      values (new.assignee_id, new.project_id, 'assigned', new.id,
              jsonb_build_object('name', new.name, 'level', new.level));
  end if;
  return new;
end $$;

create trigger work_items_notify_assigned
  after insert or update of assignee_id on public.work_items
  for each row execute function public.notify_assigned();

-- 5.2 Comment on assigned item + @mentions
create or replace function public.notify_comment() returns trigger
language plpgsql as $$
declare
  assignee uuid;
  wi_name text;
  mention_user uuid;
  mention_re text := '@\[[^]]+\]\(([0-9a-fA-F-]{36})\)';
  m text;
  matches text[];
begin
  select assignee_id, name into assignee, wi_name
    from public.work_items where id = new.work_item_id;

  -- Comment on item I'm assigned to (not my own comment)
  if assignee is not null and assignee <> new.author_id then
    insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
      values (assignee, new.project_id, 'comment_on_assigned_item', new.work_item_id,
              jsonb_build_object('name', wi_name, 'comment_id', new.id));
  end if;

  -- Mentions
  for m in select (regexp_matches(new.body, mention_re, 'g'))[1] loop
    mention_user := m::uuid;
    if mention_user is not null and mention_user <> new.author_id then
      insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
        values (mention_user, new.project_id, 'mentioned_in_comment', new.work_item_id,
                jsonb_build_object('name', wi_name, 'comment_id', new.id));
    end if;
  end loop;
  return new;
end $$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_comment();

-- 5.3 Assigned item deleted
create or replace function public.notify_assigned_deleted() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and new.assignee_id is not null
     and new.assignee_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  then
    insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
      values (new.assignee_id, new.project_id, 'assigned_item_deleted', new.id,
              jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;

create trigger work_items_notify_deleted
  after update of deleted_at on public.work_items
  for each row execute function public.notify_assigned_deleted();

-- 5.4 Predecessor moved → notify assignees of successors
create or replace function public.notify_predecessor_moved() returns trigger
language plpgsql as $$
declare
  rec record;
begin
  if (new.start_date is distinct from old.start_date) or (new.end_date is distinct from old.end_date) then
    for rec in
      select wi.assignee_id, wi.name, wi.id
        from public.dependencies d
        join public.work_items wi on wi.id = d.successor_id
       where d.predecessor_id = new.id and wi.assignee_id is not null
    loop
      if rec.assignee_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
        insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
          values (rec.assignee_id, new.project_id, 'predecessor_moved', rec.id,
                  jsonb_build_object('name', rec.name, 'predecessor_id', new.id));
      end if;
    end loop;
  end if;
  return new;
end $$;

create trigger work_items_predecessor_moved
  after update of start_date, end_date on public.work_items
  for each row execute function public.notify_predecessor_moved();

-- 5.5 Respect user-level opt-out — convert into BEFORE trigger that drops
create or replace function public.skip_if_disabled() returns trigger
language plpgsql as $$
declare
  enabled bool;
begin
  select notifications_enabled into enabled
    from public.user_settings where user_id = new.user_id;
  if enabled is false then
    return null;
  end if;
  return new;
end $$;

create trigger notifications_opt_out
  before insert on public.notifications
  for each row execute function public.skip_if_disabled();
```

---

## 6. Audit log triggers

```sql
-- Note: PL/pgSQL validates NEW/OLD field references at plan time, even inside
-- CASE branches that are never taken. project_members has no `id` column, so
-- referring to `new.id` would fail planning. We route everything through jsonb
-- to bypass the static-typing check.
create or replace function public.log_changes() returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  proj  uuid;
  ent   uuid;
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  id_key text := case when tg_argv[0] = 'project_member' then 'user_id' else 'id' end;
begin
  if tg_op = 'DELETE' then
    proj := (old_j->>'project_id')::uuid;
    ent  := (old_j->>id_key)::uuid;
    insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
      values (proj, auth.uid(), tg_argv[0], ent, 'delete', old_j, null);
    return old;
  elsif tg_op = 'INSERT' then
    proj := (new_j->>'project_id')::uuid;
    ent  := (new_j->>id_key)::uuid;
    insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
      values (proj, auth.uid(), tg_argv[0], ent, 'create', null, new_j);
    return new;
  else
    proj := (new_j->>'project_id')::uuid;
    ent  := (new_j->>id_key)::uuid;
    if old_j->>'deleted_at' is null and new_j->>'deleted_at' is not null then
      insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
        values (proj, auth.uid(), tg_argv[0], ent, 'delete', old_j, new_j);
    elsif old_j->>'deleted_at' is not null and new_j->>'deleted_at' is null then
      insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
        values (proj, auth.uid(), tg_argv[0], ent, 'restore', old_j, new_j);
    else
      insert into public.audit_log(project_id, actor_id, entity_type, entity_id, action, before, after)
        values (proj, auth.uid(), tg_argv[0], ent, 'update', old_j, new_j);
    end if;
    return new;
  end if;
end $$;

create trigger work_items_audit
  after insert or update or delete on public.work_items
  for each row execute function public.log_changes('work_item');

create trigger deps_audit
  after insert or update or delete on public.dependencies
  for each row execute function public.log_changes('dependency');

create trigger members_audit
  after insert or update or delete on public.project_members
  for each row execute function public.log_changes('project_member');
```

---

## 7. Members view (joins display name + email from auth.users)

```sql
-- Definer view (NOT security_invoker): owner reads auth.users so we don't have
-- to grant SELECT on the auth schema to clients. Visibility is gated by an
-- inline EXISTS check against project_members so callers only see rows from
-- projects they belong to.
create or replace view public.project_members_view as
select
  pm.project_id,
  pm.user_id,
  pm.role,
  pm.joined_at,
  u.email::text as email,
  s.first_name,
  s.last_name,
  coalesce(
    nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
    split_part(u.email::text, '@', 1)
  ) as display_name
from public.project_members pm
join auth.users u on u.id = pm.user_id
left join public.user_settings s on s.user_id = pm.user_id
where exists (
  select 1 from public.project_members me
   where me.project_id = pm.project_id
     and me.user_id = auth.uid()
);

grant select on public.project_members_view to authenticated;
```

---

## 8. Row-Level Security (RLS)

```sql
-- Enable RLS
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.project_invites   enable row level security;
alter table public.work_items        enable row level security;
alter table public.dependencies      enable row level security;
alter table public.comments          enable row level security;
alter table public.notifications     enable row level security;
alter table public.user_settings     enable row level security;
alter table public.audit_log         enable row level security;

-- Helper: is the current user a member of project? At least the given role?
create or replace function public.is_member(p_project uuid, p_min_role text default 'viewer')
returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members
     where project_id = p_project
       and user_id = auth.uid()
       and case p_min_role
             when 'owner'  then role = 'owner'
             when 'editor' then role in ('owner','editor')
             else true
           end
  );
$$;

grant execute on function public.is_member(uuid, text) to authenticated, anon;

-- ----- projects -----
create policy projects_select on public.projects for select
  using (is_member(id) and deleted_at is null);
create policy projects_insert on public.projects for insert
  with check (created_by = auth.uid());
create policy projects_update on public.projects for update
  using (is_member(id, 'editor'));
create policy projects_delete on public.projects for update
  using (is_member(id, 'owner'));  -- soft delete via update set deleted_at

-- ----- project_members -----
create policy pm_select on public.project_members for select
  using (is_member(project_id));
create policy pm_insert on public.project_members for insert
  with check (
    is_member(project_id, 'owner')
    or (
      -- bootstrap: first member is the creator at project creation time.
      -- Alias the inner table so the outer ref resolves to the NEW row.
      not exists (
        select 1 from public.project_members pm
         where pm.project_id = project_members.project_id
      )
      and user_id = auth.uid()
    )
  );
create policy pm_update on public.project_members for update
  using (is_member(project_id, 'owner'));
create policy pm_delete on public.project_members for delete
  using (is_member(project_id, 'owner'));

-- ----- project_invites -----
-- Anon can SELECT only by exact token (used on /invite/<token> landing — but we accept via RPC,
-- so we don't actually need an anon select policy. Keep restrictive.)
create policy invites_select on public.project_invites for select
  using (is_member(project_id, 'owner'));
create policy invites_all on public.project_invites for all
  using (is_member(project_id, 'owner'))
  with check (is_member(project_id, 'owner'));

-- ----- work_items -----
create policy wi_select on public.work_items for select
  using (is_member(project_id) and deleted_at is null);
create policy wi_insert on public.work_items for insert
  with check (is_member(project_id, 'editor'));
create policy wi_update on public.work_items for update
  using (is_member(project_id, 'editor'));
create policy wi_delete on public.work_items for delete
  using (is_member(project_id, 'editor'));

-- ----- dependencies -----
create policy dep_select on public.dependencies for select
  using (is_member(project_id));
create policy dep_write on public.dependencies for all
  using (is_member(project_id, 'editor'))
  with check (is_member(project_id, 'editor'));

-- ----- comments -----
create policy cmt_select on public.comments for select
  using (is_member(project_id));
create policy cmt_insert on public.comments for insert
  with check (is_member(project_id, 'editor') and author_id = auth.uid());
create policy cmt_update on public.comments for update
  using (
    (is_member(project_id, 'editor') and author_id = auth.uid())
    or is_member(project_id, 'owner')
  );

-- ----- notifications -----
create policy notif_select on public.notifications for select
  using (user_id = auth.uid());
create policy notif_update on public.notifications for update
  using (user_id = auth.uid());

-- ----- user_settings -----
-- SELECT: any authenticated user (so first/last name is visible to teammates via project_members_view).
-- Writes: self only.
create policy us_select on public.user_settings for select
  to authenticated using (true);
create policy us_insert on public.user_settings for insert
  with check (user_id = auth.uid());
create policy us_update on public.user_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy us_delete on public.user_settings for delete
  using (user_id = auth.uid());

-- ----- audit_log -----
create policy audit_select on public.audit_log for select
  using (is_member(project_id));
-- No write policy: rows are inserted by triggers running as table owner.
```

---

## 9. Realtime publication

```sql
-- The Supabase realtime publication is named supabase_realtime.
alter publication supabase_realtime add table
  public.work_items,
  public.dependencies,
  public.comments,
  public.notifications,
  public.project_members,
  public.projects;

-- So DELETEs carry old row payloads to subscribers
alter table public.work_items       replica identity full;
alter table public.dependencies     replica identity full;
alter table public.comments         replica identity full;
alter table public.notifications    replica identity full;
alter table public.project_members  replica identity full;
alter table public.projects         replica identity full;
```

---

## 10. Scheduled jobs (pg_cron) — Pro tier only

> Skip this section on Free tier; it's a polish item, not blocking.

```sql
-- Daily prune of audit_log entries older than 90 days
select cron.schedule(
  'prune-audit-log',
  '0 3 * * *',
  $$ delete from public.audit_log where at < now() - interval '90 days'; $$
);

-- Daily purge of soft-deleted work_items older than 30 days
select cron.schedule(
  'purge-deleted-work-items',
  '15 3 * * *',
  $$ delete from public.work_items where deleted_at is not null and deleted_at < now() - interval '30 days'; $$
);

-- Daily purge of soft-deleted projects older than 7 days (grace period)
select cron.schedule(
  'purge-deleted-projects',
  '30 3 * * *',
  $$ delete from public.projects where deleted_at is not null and deleted_at < now() - interval '7 days'; $$
);
```

---

## 11. Smoke test

After running everything, in SQL editor as your own user:

```sql
-- Create a test project
insert into public.projects (name, created_by) values ('Smoke test', auth.uid()) returning id;
-- (note the id, then:)
insert into public.project_members (project_id, user_id, role)
  values ('<that-id>', auth.uid(), 'owner');

-- Create an epic > task > subtask
insert into public.work_items (project_id, parent_id, level, name, start_date, end_date)
  values ('<id>', null, 'epic', 'E1', null, null) returning id;
insert into public.work_items (project_id, parent_id, level, name, start_date, end_date)
  values ('<id>', '<epic-id>', 'task', 'T1', '2026-06-01', '2026-06-10') returning id;

-- Verify the epic now has rolled-up dates
select level, name, start_date, end_date, progress from public.work_items where project_id = '<id>';
```

Then go to `http://localhost:5173`, sign in with the same email, and you should see the project.

---

## 11b. Migration — profiles (first/last name)

If your DB predates the profile-name feature, run this once:

```sql
-- Add first/last name columns
alter table public.user_settings
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Rebuild view to expose them + computed display_name.
-- Drop first: column order/names changed, so `create or replace` would fail.
drop view if exists public.project_members_view;
create view public.project_members_view as
select
  pm.project_id,
  pm.user_id,
  pm.role,
  pm.joined_at,
  u.email::text as email,
  s.first_name,
  s.last_name,
  coalesce(
    nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
    split_part(u.email::text, '@', 1)
  ) as display_name
from public.project_members pm
join auth.users u on u.id = pm.user_id
left join public.user_settings s on s.user_id = pm.user_id
where exists (
  select 1 from public.project_members me
   where me.project_id = pm.project_id
     and me.user_id = auth.uid()
);

grant select on public.project_members_view to authenticated;

-- Relax SELECT so the view's left-join works for any caller; writes stay self-only
drop policy if exists us_self on public.user_settings;
create policy us_select on public.user_settings for select
  to authenticated using (true);
create policy us_insert on public.user_settings for insert
  with check (user_id = auth.uid());
create policy us_update on public.user_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy us_delete on public.user_settings for delete
  using (user_id = auth.uid());
```

---

## 12. Things to double-check before production

- **Site URL & redirects** in Supabase Auth match your prod domain.
- **CORS** is auto-managed by Supabase; you typically don't need to touch it.
- **Backups**: enable PITR (Pro tier).
- **Realtime quotas**: Free tier has 200 concurrent connections, 2M messages/month. Monitor.
- **Service role key** never leaves the server. The frontend uses only the anon key.
- The `accept_invite` function uses `security definer` so it can read `auth.users`. Verify the `set search_path = public` is in place (it is above).
- Consider adding **rate limiting** to invite creation if abuse is a concern.
