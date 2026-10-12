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

begin;

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

commit;
