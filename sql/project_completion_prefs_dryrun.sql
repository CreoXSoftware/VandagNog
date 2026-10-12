-- =====================================================================
-- DRY RUN for project_completion_prefs.sql — changes NOTHING.
-- Runs the migration, then exercises completion and pin/hide as real users
-- under RLS, then raises an exception so everything rolls back. The result
-- is the error text "DRYRUN {...}"; expected values are at the bottom.
-- Generated from project_completion_prefs.sql; re-generate if that file changes.
-- =====================================================================
-- =====================================================================
-- Completed projects, and per-user pinned / hidden projects.
--
-- 1. projects.completed_at / completed_by. Shared by everyone in the project:
--    marking it completed moves it out of the default "Active" list on the
--    Projects page for all members. Editors and owners can toggle it (the
--    existing projects_update policy); completed_by is stamped by a trigger
--    so the client cannot attribute it to someone else.
--
-- 2. project_user_prefs. Personal: pinning or hiding a project only changes
--    your own Projects page. One row per (user, project), only ever visible to
--    its owner.
--
-- Requires project_teams.sql (is_member via project_role). Run once in the
-- Supabase SQL editor.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Completed
-- ---------------------------------------------------------------------
alter table public.projects
  add column completed_at timestamptz,
  add column completed_by uuid references auth.users(id) on delete set null;

create or replace function public.stamp_project_completed()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.completed_at is distinct from old.completed_at then
    new.completed_by := case when new.completed_at is null then null else auth.uid() end;
  else
    new.completed_by := old.completed_by;
  end if;
  return new;
end;
$function$;

create trigger projects_stamp_completed
  before update of completed_at, completed_by on public.projects
  for each row execute function public.stamp_project_completed();

-- ---------------------------------------------------------------------
-- 2. Pinned / hidden, per user
-- ---------------------------------------------------------------------
create table public.project_user_prefs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  pinned_at  timestamptz,
  hidden_at  timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- The PK covers lookups by user; this covers the FK cascade from projects.
create index project_user_prefs_project_idx on public.project_user_prefs (project_id);

alter table public.project_user_prefs enable row level security;

create policy project_user_prefs_select on public.project_user_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy project_user_prefs_insert on public.project_user_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(project_id));

create policy project_user_prefs_update on public.project_user_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy project_user_prefs_delete on public.project_user_prefs
  for delete to authenticated
  using (user_id = (select auth.uid()));

create trigger project_user_prefs_touch
  before update on public.project_user_prefs
  for each row execute function public.touch_updated_at();

revoke all on public.project_user_prefs from public, anon;
grant select, insert, update, delete on public.project_user_prefs to authenticated;


-- ======================= TESTS (always aborts) =======================
do $test$
declare
  P uuid := 'bb25525d-6e8a-4956-a92c-8c313f0fa80e';  -- OmanG6
  O uuid; E uuid; X uuid;
  out jsonb := '{}'::jsonb;
  n int; r text;
begin
  select user_id into O from project_members where project_id = P and role = 'owner' limit 1;
  select user_id into E from project_members where project_id = P and role = 'editor' limit 1;
  -- someone with no access to P at all
  select u.id into X from auth.users u where project_role(P, u.id) is null limit 1;

  -- 1. an editor marks it completed, claiming the owner did it; the trigger
  --    attributes it to the editor anyway
  perform set_config('request.jwt.claims', json_build_object('sub', E, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update projects set completed_at = now(), completed_by = O where id = P;
  select case when completed_by = E then 'editor' when completed_by = O then 'owner (bad)' else coalesce(completed_by::text, 'null') end
    into r from projects where id = P;
  out := out || jsonb_build_object('1_completed_by', r);

  -- 2. editing something else keeps the stamp; forging completed_by alone is ignored
  update projects set description = description, completed_by = O where id = P;
  select case when completed_by = E then 'editor' else 'changed (bad)' end into r from projects where id = P;
  out := out || jsonb_build_object('2_stamp_kept', r);

  -- 3. reopening clears both
  update projects set completed_at = null where id = P;
  select coalesce(completed_by::text, 'null') into r from projects where id = P;
  out := out || jsonb_build_object('3_reopened_by', r);

  -- 4. the editor pins and hides for themselves
  insert into project_user_prefs (project_id, pinned_at) values (P, now());
  update project_user_prefs set hidden_at = now() where project_id = P;
  select count(*) into n from project_user_prefs where pinned_at is not null and hidden_at is not null;
  out := out || jsonb_build_object('4_editor_rows', n);

  -- 5. cannot write a row for someone else
  begin
    insert into project_user_prefs (user_id, project_id, pinned_at) values (O, P, now());
    out := out || jsonb_build_object('5_forge_other_user', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('5_forge_other_user', 'blocked'); end;
  reset role;

  -- 6. the owner does not see the editor's prefs
  perform set_config('request.jwt.claims', json_build_object('sub', O, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from project_user_prefs;
  out := out || jsonb_build_object('6_owner_sees', n);
  reset role;

  -- 7. an outsider cannot pin a project they cannot see
  perform set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into project_user_prefs (project_id, pinned_at) values (P, now());
    out := out || jsonb_build_object('7_outsider_pin', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('7_outsider_pin', 'blocked'); end;
  reset role;

  -- 8. anon has no access at all
  set local role anon;
  begin
    perform 1 from project_user_prefs;
    out := out || jsonb_build_object('8_anon', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('8_anon', 'blocked'); end;
  reset role;

  raise exception 'DRYRUN %', out;
end
$test$;

-- Expected:
--   1_completed_by "editor", 2_stamp_kept "editor", 3_reopened_by "null"
--   4_editor_rows 1, 5_forge_other_user "blocked", 6_owner_sees 0
--   7_outsider_pin "blocked", 8_anon "blocked"
