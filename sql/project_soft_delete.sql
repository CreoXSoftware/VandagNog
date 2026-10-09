-- =====================================================================
-- Delete (and restore) a project from the app.
--
-- Deleting stamps projects.deleted_at/deleted_by. Nothing is removed: tasks,
-- dependencies, comments, time entries and members stay, so a restore brings
-- the project back exactly as it was.
--
-- While deleted, is_member() is false for everyone, so the project and all of
-- its rows disappear from every page (the Tasks page loads work_items across
-- projects, so hiding just the projects row would not be enough). People keep
-- seeing their own time entries, as time_entries_select allows own rows.
--
-- Only owners can delete or restore. Restoring cannot go through is_member
-- (it is false while deleted), so it checks project_role() directly.
--
-- Requires project_teams.sql (project_role). Run once in the Supabase SQL
-- editor.
-- =====================================================================

begin;

alter table public.projects
  add column deleted_by uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- 1. Deleted projects are invisible through every policy
-- ---------------------------------------------------------------------
create or replace function public.is_member(p_project uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select case p_min_role
             when 'owner'  then r = 'owner'
             when 'editor' then r in ('owner', 'editor')
             else r is not null
           end
      from (select public.project_role(p_project, auth.uid()) as r) x
     where not exists (
       select 1 from public.projects p
        where p.id = p_project and p.deleted_at is not null
     )
  ), false);
$function$;

-- ---------------------------------------------------------------------
-- 2. Only owners may change deleted_at / deleted_by
-- ---------------------------------------------------------------------
-- projects_update lets editors update the row (name, description, working
-- days), so without this an editor could soft-delete a project.
create or replace function public.guard_project_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.deleted_at, new.deleted_by) is distinct from (old.deleted_at, old.deleted_by)
     and auth.uid() is not null
     and public.project_role(old.id, auth.uid()) is distinct from 'owner'
  then
    raise exception 'Only project owners can delete or restore a project';
  end if;
  return new;
end $function$;

revoke execute on function public.guard_project_delete() from public, anon, authenticated;

create trigger projects_guard_delete
  before update of deleted_at, deleted_by on public.projects
  for each row execute function public.guard_project_delete();

-- ---------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------
create or replace function public.delete_project(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_member(p_id, 'owner') then
    raise exception 'Only project owners can delete a project';
  end if;
  update public.projects
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_id and deleted_at is null;
end $function$;

create or replace function public.restore_project(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if public.project_role(p_id, auth.uid()) is distinct from 'owner' then
    raise exception 'Only project owners can restore a project';
  end if;
  update public.projects
     set deleted_at = null, deleted_by = null
   where id = p_id and deleted_at is not null;
end $function$;

-- Deleted projects the caller owns (and so can restore), newest first.
create or replace function public.deleted_projects_list()
returns table(
  id                 uuid,
  name               text,
  description        text,
  deleted_at         timestamptz,
  deleted_by         uuid,
  deleted_by_name    text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.name, p.description, p.deleted_at, p.deleted_by,
         public.user_display_name(p.deleted_by)
    from public.projects p
   where p.deleted_at is not null
     and public.project_role(p.id, auth.uid()) = 'owner'
   order by p.deleted_at desc;
$function$;

revoke execute on function public.delete_project(uuid) from public, anon;
revoke execute on function public.restore_project(uuid) from public, anon;
revoke execute on function public.deleted_projects_list() from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;
grant execute on function public.restore_project(uuid) to authenticated;
grant execute on function public.deleted_projects_list() to authenticated;

commit;
