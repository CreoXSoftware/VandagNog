-- =====================================================================
-- DRY RUN for project_teams.sql — changes NOTHING.
-- Runs the whole migration, exercises it as real users under RLS, then
-- raises an exception so the transaction rolls back. The result is the
-- error text: "DRYRUN {...}". Expected values are listed at the bottom.
-- Generated from project_teams.sql; re-generate if that file changes.
-- =====================================================================
-- =====================================================================
-- Link whole teams to a project.
--
-- Before: "Add whole team" copied each team member into project_members, so a
-- team was only a shortcut for picking people. After: project_teams links the
-- team itself; everyone in it (now and later) gets access with the link's role.
--
-- Effective project role for a user (project_role):
--   1. a direct project_members row wins, whatever its level, so an owner can
--      raise OR lower one team member ("override");
--   2. otherwise the highest role among the linked teams the user is in;
--   3. otherwise null (no access).
--
-- Removing someone's direct row therefore drops them back to their team role
-- instead of out of the project. Task assignments are never touched by any
-- membership change (assignee_id has no cascade); the assignee trigger now
-- only validates a NEW assignee, so tasks still assigned to someone who has
-- left stay editable.
--
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The link table
-- ---------------------------------------------------------------------
create table public.project_teams (
  project_id uuid not null references public.projects(id) on delete cascade,
  team_id    uuid not null references public.teams(id)    on delete cascade,
  role       text not null default 'editor'
             check (role in ('owner', 'editor', 'viewer')),
  added_by   uuid default auth.uid() references auth.users(id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (project_id, team_id)
);

-- PK covers project_id lookups; team_id is the other side of every join.
create index project_teams_team_id_idx on public.project_teams(team_id);

alter table public.project_teams enable row level security;

-- Linking goes through add_team_to_project (it checks you are in the team).
-- Owners may change a link's role or unlink directly.
create policy pt_select on public.project_teams
  for select to authenticated using (public.is_member(project_id));
create policy pt_update on public.project_teams
  for update to authenticated
  using (public.is_member(project_id, 'owner'))
  with check (public.is_member(project_id, 'owner'));
create policy pt_delete on public.project_teams
  for delete to authenticated using (public.is_member(project_id, 'owner'));

revoke all on public.project_teams from anon;
grant select, update, delete on public.project_teams to authenticated;

alter publication supabase_realtime add table public.project_teams;

-- ---------------------------------------------------------------------
-- 2. Effective role
-- ---------------------------------------------------------------------
create or replace function public.project_role(p_project uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select pm.role
       from public.project_members pm
      where pm.project_id = p_project and pm.user_id = p_user),
    (select pt.role
       from public.project_teams pt
       join public.team_members tm on tm.team_id = pt.team_id
      where pt.project_id = p_project and tm.user_id = p_user
      order by case pt.role when 'owner' then 0 when 'editor' then 1 else 2 end
      limit 1)
  );
$function$;

-- Takes an arbitrary user id, so callers could probe other people's access.
-- Only definer functions/triggers (running as the owner) call it.
revoke execute on function public.project_role(uuid, uuid) from public, anon, authenticated;

-- Same signature as before, so every policy keeps pointing at it.
-- coalesce: plpgsql callers do `if not is_member(...)`, and null would pass.
create or replace function public.is_member(p_project uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    case p_min_role
      when 'owner'  then r = 'owner'
      when 'editor' then r in ('owner', 'editor')
      else r is not null
    end,
    false)
  from (select public.project_role(p_project, auth.uid()) as r) x;
$function$;

-- ---------------------------------------------------------------------
-- 3. Assignee check: effective membership, and only for a new assignee
-- ---------------------------------------------------------------------
-- Definer because the editor saving the task may not be able to see the
-- assignee's team rows through RLS.
create or replace function public.enforce_assignee_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.assignee_id is null then return new; end if;
  -- Unchanged assignee: keep tasks of people who have since left editable.
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  if public.project_role(new.project_id, new.assignee_id) is null then
    raise exception 'Assignee % is not a member of project %', new.assignee_id, new.project_id;
  end if;
  return new;
end $function$;

revoke execute on function public.enforce_assignee_membership() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Member list: everyone with effective access, plus where it comes from
-- ---------------------------------------------------------------------
-- Return type changes, so drop + create (only the client calls it).
drop function public.project_members_list(uuid);

create function public.project_members_list(p_project uuid)
returns table(
  project_id   uuid,
  user_id      uuid,
  role         text,    -- effective role
  joined_at    timestamptz,
  email        text,
  first_name   text,
  last_name    text,
  display_name text,
  direct_role  text,    -- null when access is only via a team
  team_role    text,    -- best role from linked teams, null when none
  team_ids     uuid[]   -- linked teams this person is in
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with direct as (
    select pm.user_id, pm.role, pm.joined_at
      from public.project_members pm
     where pm.project_id = p_project
  ),
  via as (
    select tm.user_id,
           (array_agg(pt.role order by case pt.role when 'owner' then 0 when 'editor' then 1 else 2 end))[1] as team_role,
           array_agg(pt.team_id order by pt.added_at) as team_ids,
           min(greatest(pt.added_at, tm.joined_at)) as joined_at
      from public.project_teams pt
      join public.team_members tm on tm.team_id = pt.team_id
     where pt.project_id = p_project
     group by tm.user_id
  ),
  eff as (
    select coalesce(d.user_id, v.user_id)       as user_id,
           coalesce(d.role, v.team_role)        as role,
           coalesce(d.joined_at, v.joined_at)   as joined_at,
           d.role                               as direct_role,
           v.team_role,
           coalesce(v.team_ids, '{}'::uuid[])   as team_ids
      from direct d
      full join via v on v.user_id = d.user_id
  )
  select
    p_project,
    e.user_id,
    e.role,
    e.joined_at,
    u.email::text,
    s.first_name,
    s.last_name,
    coalesce(
      nullif(trim(both from concat_ws(' ', s.first_name, s.last_name)), ''),
      split_part(u.email::text, '@', 1)
    ),
    e.direct_role,
    e.team_role,
    e.team_ids
  from eff e
  join auth.users u on u.id = e.user_id
  left join public.user_settings s on s.user_id = e.user_id
  where public.is_member(p_project);
$function$;

revoke execute on function public.project_members_list(uuid) from public, anon;
grant execute on function public.project_members_list(uuid) to authenticated;

-- Linked teams with names. Members of the project may not be in the team, so
-- teams RLS would hide the name; gate on project membership instead.
create or replace function public.project_teams_list(p_project uuid)
returns table(
  team_id      uuid,
  name         text,
  role         text,
  member_count integer,
  added_by     uuid,
  added_at     timestamptz,
  i_am_member  boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pt.team_id,
         t.name,
         pt.role,
         (select count(*)::int from public.team_members tm where tm.team_id = pt.team_id),
         pt.added_by,
         pt.added_at,
         exists (select 1 from public.team_members me
                  where me.team_id = pt.team_id and me.user_id = auth.uid())
    from public.project_teams pt
    join public.teams t on t.id = pt.team_id
   where pt.project_id = p_project
     and public.is_member(p_project)
   order by t.name;
$function$;

revoke execute on function public.project_teams_list(uuid) from public, anon;
grant execute on function public.project_teams_list(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Team RPCs: link instead of copy; owner checks use effective role
-- ---------------------------------------------------------------------
-- Same signature as before. Now upserts the link and returns how many people
-- the team gives access to.
create or replace function public.add_team_to_project(p_project_id uuid, p_team_id uuid, p_role text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_role not in ('owner','editor','viewer') then raise exception 'Invalid role'; end if;
  if not public.is_member(p_project_id, 'owner') then
    raise exception 'Only project owners can add members';
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team_id and user_id = auth.uid()) then
    raise exception 'You must be a member of the team to share it';
  end if;

  insert into public.project_teams(project_id, team_id, role, added_by)
  values (p_project_id, p_team_id, p_role, auth.uid())
  on conflict (project_id, team_id) do update set role = excluded.role;

  select count(*)::int into v_count from public.team_members where team_id = p_team_id;
  return v_count;
end $function$;

create or replace function public.add_user_to_project_from_team(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_role not in ('owner','editor','viewer') then raise exception 'Invalid role'; end if;
  if not public.is_member(p_project_id, 'owner') then
    raise exception 'Only project owners can add members';
  end if;
  if not exists (
    select 1 from public.team_members ta
    join public.team_members tb on tb.team_id = ta.team_id
    where ta.user_id = auth.uid() and tb.user_id = p_user_id
  ) then raise exception 'Target user is not in any of your teams'; end if;

  insert into public.project_members(project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do nothing;
end $function$;

create or replace function public.create_invite(p_project_id uuid, p_email text, p_role text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_id uuid;
begin
  if not public.is_member(p_project_id, 'owner') then
    raise exception 'Only owners can invite';
  end if;

  insert into public.project_invites(project_id, email, role, invited_by)
    values (p_project_id, p_email, p_role, auth.uid())
  on conflict (project_id, email)
    do update set role = excluded.role, expires_at = now() + interval '14 days', accepted_at = null
  returning id, token into v_id, v_token;

  insert into public.notifications(user_id, project_id, event_type, entity_id, payload)
  select u.id, p_project_id, 'invited', v_id, jsonb_build_object('role', p_role, 'email', p_email)
    from auth.users u
   where lower(u.email) = lower(p_email);

  return json_build_object('id', v_id, 'token', v_token);
end $function$;

-- ---------------------------------------------------------------------
-- 6. Client visibility: team-linked members see the project's client too
-- ---------------------------------------------------------------------
create or replace function public.can_see_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id
       and c.deleted_at is null
       and (
         c.owner_user_id = auth.uid()
         or (c.team_id is not null and public.is_team_member(c.team_id))
         or exists (
           select 1 from public.projects p
            where p.client_id = c.id
              and public.is_member(p.id)
         )
       )
  );
$function$;

drop policy clients_select on public.clients;
create policy clients_select on public.clients
  for select using (
    deleted_at is null
    and (
      owner_user_id = auth.uid()
      or (team_id is not null and public.is_team_member(team_id))
      or exists (
        select 1 from public.projects p
         where p.client_id = clients.id
           and public.is_member(p.id)
      )
    )
  );

-- Still a definer view on purpose (see project_client_view notes); only the
-- membership gate changes. Column list is identical, so OR REPLACE is fine.
create or replace view public.project_client_view as
  select p.id as project_id,
         c.id as client_id,
         c.name as client_name,
         case when c.owner_user_id is not null then 'private'::text else 'team'::text end as scope,
         c.team_id,
         t.name as team_name,
         c.owner_user_id,
         public.user_display_name(c.owner_user_id) as owner_display_name
    from public.projects p
    join public.clients c on c.id = p.client_id and c.deleted_at is null
    left join public.teams t on t.id = c.team_id
   where public.is_member(p.id);

-- ---------------------------------------------------------------------
-- 7. Audit team links alongside member changes
-- ---------------------------------------------------------------------
alter table public.audit_log drop constraint audit_log_entity_type_check;
alter table public.audit_log add constraint audit_log_entity_type_check
  check (entity_type in ('work_item', 'dependency', 'project_member', 'project_team'));

create or replace function public.log_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  proj  uuid;
  ent   uuid;
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  id_key text := case tg_argv[0]
                   when 'project_member' then 'user_id'
                   when 'project_team'   then 'team_id'
                   else 'id'
                 end;
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
end $function$;

create trigger project_teams_audit
  after insert or delete or update on public.project_teams
  for each row execute function public.log_changes('project_team');

-- ======================= TESTS (always aborts) =======================
do $test$
declare
  P uuid := 'bb25525d-6e8a-4956-a92c-8c313f0fa80e';  -- OmanG6
  U uuid := '6113ceaa-de3c-493e-a09a-986f60dc7d3b';  -- direct editor, in a team, has tasks
  T uuid; O uuid; X uuid; task uuid; other_task uuid;
  out jsonb := '{}'::jsonb;
  n int; r text; ok boolean;
begin
  select tm.team_id into T from team_members tm where tm.user_id = U limit 1;
  select user_id into O from project_members where project_id = P and role = 'owner' limit 1;
  select u.id into X from auth.users u
   where not exists (select 1 from project_members pm where pm.project_id = P and pm.user_id = u.id)
     and not exists (select 1 from team_members tm where tm.team_id = T and tm.user_id = u.id) limit 1;
  select id into task from work_items where project_id = P and assignee_id = U and deleted_at is null limit 1;
  select id into other_task from work_items where project_id = P and assignee_id is distinct from U and deleted_at is null limit 1;

  -- 1. baseline as U (direct editor)
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from work_items where project_id = P;
  out := out || jsonb_build_object('1_base_items', n, '1_base_editor', is_member(P, 'editor'));
  reset role;

  -- 2. link U's team as viewer, remove U's individual row
  insert into project_teams(project_id, team_id, role) values (P, T, 'viewer');
  delete from project_members where project_id = P and user_id = U;
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from work_items where project_id = P;
  out := out || jsonb_build_object('2_team_items', n, '2_team_member', is_member(P), '2_team_editor', is_member(P, 'editor'));
  select l.role || '/' || coalesce(l.direct_role, '-') || '/' || coalesce(l.team_role, '-') into r
    from project_members_list(P) l where l.user_id = U;
  out := out || jsonb_build_object('2_list_eff/direct/team', r);
  select count(*) into n from project_teams_list(P); out := out || jsonb_build_object('2_teams_list', n);
  begin
    update work_items set name = name where id = other_task;
    get diagnostics n = row_count; out := out || jsonb_build_object('2_viewer_update_rows', n);
  exception when others then out := out || jsonb_build_object('2_viewer_update_err', sqlerrm); end;
  begin
    perform project_role(P, U); out := out || jsonb_build_object('2_project_role_callable', 'yes (bad)');
  exception when others then out := out || jsonb_build_object('2_project_role_callable', 'no'); end;
  reset role;

  -- 3. overrides: direct editor beats team viewer; direct viewer beats team owner
  insert into project_members(project_id, user_id, role) values (P, U, 'editor');
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  set local role authenticated;
  out := out || jsonb_build_object('3_override_up_editor', is_member(P, 'editor'));
  reset role;
  update project_teams set role = 'owner' where project_id = P and team_id = T;
  update project_members set role = 'viewer' where project_id = P and user_id = U;
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  set local role authenticated;
  out := out || jsonb_build_object('3_override_down_editor', is_member(P, 'editor'), '3_override_down_member', is_member(P));
  reset role;

  -- 4. U loses all access; the owner edits U's old task
  delete from project_teams where project_id = P and team_id = T;
  delete from project_members where project_id = P and user_id = U;
  perform set_config('request.jwt.claims', json_build_object('sub', O, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update work_items set name = name || '', assignee_id = assignee_id where id = task;
    select assignee_id = U into ok from work_items where id = task;
    out := out || jsonb_build_object('4_old_task_saves_keeps_assignee', ok);
  exception when others then out := out || jsonb_build_object('4_old_task_err', sqlerrm); end;
  begin
    update work_items set assignee_id = U where id = other_task;
    out := out || jsonb_build_object('4_assign_nonmember', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('4_assign_nonmember', 'blocked'); end;
  select count(*) into n from project_client_view where project_id = P;
  out := out || jsonb_build_object('4_owner_client_view', n);
  reset role;

  -- 5. U sees nothing now
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from work_items where project_id = P;
  out := out || jsonb_build_object('5_removed_items', n);
  reset role;

  -- 6. outsider
  perform set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true);
  set local role authenticated;
  out := out || jsonb_build_object('6_outsider_member', is_member(P), '6_outsider_not_owner', not is_member(P, 'owner'));
  reset role;

  select count(*) into n from audit_log where entity_type = 'project_team' and project_id = P;
  out := out || jsonb_build_object('7_audit_rows', n);

  raise exception 'DRYRUN %', out;
end
$test$;

-- Expected:
--   1_base_items = 2_team_items = number of live tasks (e.g. 74), 1_base_editor true
--   2_team_member true, 2_team_editor false, 2_list_eff/direct/team "viewer/-/viewer"
--   2_teams_list 1, 2_viewer_update_rows 0, 2_project_role_callable "no"
--   3_override_up_editor true, 3_override_down_editor false, 3_override_down_member true
--   4_old_task_saves_keeps_assignee true, 4_assign_nonmember "blocked", 4_owner_client_view 0 or 1
--   5_removed_items 0, 6_outsider_member false, 6_outsider_not_owner true, 7_audit_rows 3 (link, role change, unlink)
