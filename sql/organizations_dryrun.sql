-- =====================================================================
-- DRY RUN for organizations.sql + teams_drop.sql — changes NOTHING.
-- Snapshots every (project, user) role, runs both migrations, checks that
-- nobody lost access or dropped a level, exercises the new rules as real
-- users under RLS, then raises so the transaction rolls back. The result is
-- the error text: "DRYRUN {...}". Expected values are listed at the bottom.
-- Generated from the two migration files; re-generate if they change.
-- =====================================================================

begin;

create temp table _before on commit drop as
  select p.id as project_id, u.id as user_id, public.project_role(p.id, u.id) as role
    from public.projects p cross join auth.users u;

-- ===================== organizations.sql =====================
-- =====================================================================
-- Organizations replace teams (step 1 of 2; step 2 is teams_drop.sql).
--
-- An organization owns projects and clients. Its people have one role:
--   owner  / admin : owner of every project in the org; admins manage people
--                    and the invite code, owners also change roles and can
--                    delete the org.
--   member         : editor of every project in the org, and can create
--                    projects; an own owner role (project_members) or having
--                    created the project makes them its owner.
--   guest          : sees only the projects shared with them (an own
--                    project_members row). Anyone added to a project who is
--                    not in its org becomes a guest automatically.
--
-- Every user also has a "Personal" organization (is_personal) that only they
-- are in; it can't be joined, left, renamed or deleted, but its projects can
-- still be shared with guests.
--
-- project_role() stays the single access check — every RLS policy goes
-- through is_member() -> project_role(), so they need no changes.
--
-- Port of the live data:
--   * one "CreoX" org (keeps the CreoX team's invite code), every project and
--     client moves into it;
--   * CreoX Bestuur -> owners, CreoX -> members, CreoX Guests and anyone else
--     with a project role -> guests;
--   * team links that gave more than the org now does become own project
--     roles, so nobody loses a level (with members at editor, only links to
--     guests or as owner could; today there are none);
--   * a Personal org for every user.
--
-- The team tables stay (unused) until teams_drop.sql runs, so this step can
-- be checked before anything is thrown away.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  description text,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  is_personal boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One personal org per user.
create unique index organizations_one_personal on public.organizations (created_by) where is_personal;
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

create table public.org_members (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null check (role in ('owner', 'admin', 'member', 'guest')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

alter table public.projects add column org_id uuid references public.organizations(id) on delete restrict;
alter table public.clients add column org_id uuid references public.organizations(id) on delete restrict;
-- The organization picked in the top bar, so it follows the user across devices.
alter table public.user_settings add column current_org_id uuid references public.organizations(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Org access helpers
-- ---------------------------------------------------------------------
-- p_user's role in p_org, or null. Internal (takes any user).
create function public.org_role(p_org uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select m.role from public.org_members m where m.org_id = p_org and m.user_id = p_user;
$$;

-- Am I in p_org at p_min_role or above? guest < member < admin < owner.
create function public.is_org_member(p_org uuid, p_min_role text default 'member')
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case p_min_role
             when 'owner'  then m.role = 'owner'
             when 'admin'  then m.role in ('owner', 'admin')
             when 'member' then m.role in ('owner', 'admin', 'member')
             else true
           end
      from public.org_members m
     where m.org_id = p_org and m.user_id = auth.uid()
  ), false);
$$;

-- The user's personal org, created on first need. Internal.
create function public.ensure_personal_org(p_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select o.id into v_id from public.organizations o where o.is_personal and o.created_by = p_user;
  if v_id is null then
    insert into public.organizations (name, is_personal, created_by)
    values ('Personal', true, p_user)
    on conflict (created_by) where is_personal do nothing
    returning id into v_id;
    if v_id is null then
      select o.id into v_id from public.organizations o where o.is_personal and o.created_by = p_user;
    end if;
  end if;
  insert into public.org_members (org_id, user_id, role) values (v_id, p_user, 'owner')
  on conflict (org_id, user_id) do nothing;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Port the live data
-- ---------------------------------------------------------------------
-- Setting org_id is not an edit: keep updated_at (the Projects page sorts
-- by activity) as it is.
alter table public.projects disable trigger projects_touch;
alter table public.clients disable trigger clients_touch;

do $port$
declare
  v_creox   uuid;
  t_creox   uuid;
  t_bestuur uuid;
  t_guests  uuid;
begin
  -- strict: exactly one team by each name, or the port stops here.
  select t.id into strict t_creox   from public.teams t where t.name = 'CreoX';
  select t.id into strict t_bestuur from public.teams t where t.name = 'CreoX Bestuur';
  select t.id into strict t_guests  from public.teams t where t.name = 'CreoX Guests';

  -- Personal orgs for everyone.
  perform public.ensure_personal_org(u.id) from auth.users u;

  insert into public.organizations (name, description, invite_code, created_by, created_at)
  select 'CreoX', t.description, t.invite_code, t.created_by, t.created_at
    from public.teams t where t.id = t_creox
  returning id into v_creox;

  insert into public.org_members (org_id, user_id, role, joined_at)
  select v_creox, tm.user_id, 'owner', tm.joined_at
    from public.team_members tm where tm.team_id = t_bestuur;

  insert into public.org_members (org_id, user_id, role, joined_at)
  select v_creox, tm.user_id, 'member', tm.joined_at
    from public.team_members tm where tm.team_id = t_creox
  on conflict (org_id, user_id) do nothing;

  insert into public.org_members (org_id, user_id, role, joined_at)
  select v_creox, tm.user_id, 'guest', tm.joined_at
    from public.team_members tm where tm.team_id = t_guests
  on conflict (org_id, user_id) do nothing;

  update public.projects set org_id = v_creox;

  -- Anyone else with a project role in CreoX's projects is a guest.
  insert into public.org_members (org_id, user_id, role, joined_at)
  select v_creox, pm.user_id, 'guest', min(pm.joined_at)
    from public.project_members pm
   group by pm.user_id
  on conflict (org_id, user_id) do nothing;

  -- Team links -> own project roles, where the org role doesn't already give
  -- as much: members are editors everywhere, guests get nothing.
  with links as (
    select pt.project_id,
           tm.user_id,
           (array_agg(pt.role order by case pt.role when 'owner' then 0 when 'editor' then 1 else 2 end))[1] as role,
           min(greatest(pt.added_at, tm.joined_at)) as joined_at
      from public.project_teams pt
      join public.team_members tm on tm.team_id = pt.team_id
     group by pt.project_id, tm.user_id
  )
  insert into public.project_members (project_id, user_id, role, joined_at)
  select l.project_id, l.user_id, l.role, l.joined_at
    from links l
    join public.org_members om on om.org_id = v_creox and om.user_id = l.user_id
   where om.role = 'guest' or (om.role = 'member' and l.role = 'owner')
  on conflict (project_id, user_id) do update set role = excluded.role
   where (case excluded.role when 'owner' then 0 when 'editor' then 1 else 2 end)
       < (case project_members.role when 'owner' then 0 when 'editor' then 1 else 2 end);

  -- Team clients and any client a project uses -> CreoX; an unused private
  -- client -> its owner's personal org.
  update public.clients c
     set org_id = coalesce(
       case when c.team_id is not null
              or exists (select 1 from public.projects p where p.client_id = c.id)
            then v_creox end,
       (select o.id from public.organizations o where o.is_personal and o.created_by = c.owner_user_id),
       v_creox);
end
$port$;

alter table public.projects enable trigger projects_touch;
alter table public.clients enable trigger clients_touch;

alter table public.projects alter column org_id set not null;
alter table public.clients alter column org_id set not null;
create index projects_org_idx on public.projects (org_id);

-- Clients are scoped by org now: the private/team split and its uniqueness
-- rules go (the columns themselves go in teams_drop.sql).
alter table public.clients drop constraint clients_scope_xor;
drop index public.clients_unique_private;
drop index public.clients_unique_team;
create unique index clients_unique_org_name on public.clients (org_id, lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. Project access
-- ---------------------------------------------------------------------
-- Effective role of p_user on p_project (see the header). Internal; callers
-- use is_member(), which also hides deleted projects.
create or replace function public.project_role(p_project uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
           when m.role in ('owner', 'admin') then 'owner'
           when m.role = 'member' then
             case when pm.role = 'owner' or p.created_by = p_user then 'owner' else 'editor' end
           when m.role = 'guest' then pm.role
         end
    from public.projects p
    left join public.org_members m on m.org_id = p.org_id and m.user_id = p_user
    left join public.project_members pm on pm.project_id = p.id and pm.user_id = p_user
   where p.id = p_project;
$$;

-- Effective members of one project: everyone in its org (not guests) plus
-- anyone with an own role. direct_role = own project_members role,
-- org_role = role in the project's org.
drop function public.project_members_list(uuid);
create function public.project_members_list(p_project uuid)
returns table (
  project_id uuid, user_id uuid, role text, joined_at timestamptz,
  email text, first_name text, last_name text, display_name text,
  direct_role text, org_role text
)
language sql stable security definer set search_path = public
as $$
  with prj as (
    select p.id, p.org_id from public.projects p where p.id = p_project
  ),
  cand as (
    select m.user_id from prj join public.org_members m on m.org_id = prj.org_id and m.role <> 'guest'
    union
    select pm.user_id from public.project_members pm where pm.project_id = p_project
  )
  select
    p_project,
    c.user_id,
    r.role,
    coalesce(pm.joined_at, m.joined_at),
    u.email::text,
    s.first_name,
    s.last_name,
    coalesce(
      nullif(trim(both from concat_ws(' ', s.first_name, s.last_name)), ''),
      split_part(u.email::text, '@', 1)
    ),
    pm.role,
    m.role
  from cand c
  cross join prj
  cross join lateral (select public.project_role(p_project, c.user_id) as role) r
  join auth.users u on u.id = c.user_id
  left join public.project_members pm on pm.project_id = p_project and pm.user_id = c.user_id
  left join public.org_members m on m.org_id = prj.org_id and m.user_id = c.user_id
  left join public.user_settings s on s.user_id = c.user_id
  where r.role is not null
    and public.is_member(p_project);
$$;

-- The same for every project in an org I can see, in one call (Tasks,
-- Workload, Tracker and the Projects list would otherwise call
-- project_members_list once per project).
create function public.org_project_members(p_org uuid)
returns table (
  project_id uuid, user_id uuid, role text, direct_role text, org_role text,
  email text, first_name text, last_name text, display_name text
)
language sql stable security definer set search_path = public
as $$
  with vis as (
    select p.id from public.projects p
     where p.org_id = p_org and p.deleted_at is null and public.is_member(p.id)
  ),
  cand as (
    select v.id as project_id, m.user_id
      from vis v
      join public.org_members m on m.org_id = p_org and m.role <> 'guest'
    union
    select pm.project_id, pm.user_id
      from public.project_members pm
      join vis v on v.id = pm.project_id
  )
  select
    c.project_id,
    c.user_id,
    r.role,
    pm.role,
    m.role,
    u.email::text,
    s.first_name,
    s.last_name,
    coalesce(
      nullif(trim(both from concat_ws(' ', s.first_name, s.last_name)), ''),
      split_part(u.email::text, '@', 1)
    )
  from cand c
  cross join lateral (select public.project_role(c.project_id, c.user_id) as role) r
  join auth.users u on u.id = c.user_id
  left join public.project_members pm on pm.project_id = c.project_id and pm.user_id = c.user_id
  left join public.org_members m on m.org_id = p_org and m.user_id = c.user_id
  left join public.user_settings s on s.user_id = c.user_id
  where r.role is not null;
$$;

-- Adding someone to a project makes them a guest of its org if they aren't in it.
create function public.project_members_ensure_org()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  select p.org_id, new.user_id, 'guest' from public.projects p where p.id = new.project_id
  on conflict (org_id, user_id) do nothing;
  return new;
end $$;
create trigger project_members_ensure_org after insert on public.project_members
  for each row execute function public.project_members_ensure_org();

-- Leaving an org (or being removed) ends every own role in its projects.
-- Task assignments are left alone, as with any membership change.
create function public.org_members_cleanup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.project_members pm
   using public.projects p
   where p.id = pm.project_id and p.org_id = old.org_id and pm.user_id = old.user_id;
  return old;
end $$;
create trigger org_members_cleanup after delete on public.org_members
  for each row execute function public.org_members_cleanup();

-- Project settings (name, description, working days, client) are for project
-- owners — which includes org owners/admins and the creator. Editors may still
-- mark a project completed. created_by can't be rewritten (it grants owner),
-- and org_id only changes through move_project_to_org.
create function public.guard_project_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;  -- SQL editor / service role
  if new.created_by is distinct from old.created_by then
    raise exception 'A project''s creator cannot be changed';
  end if;
  if new.org_id is distinct from old.org_id
     and coalesce(current_setting('app.project_move', true), '') <> 'on' then
    raise exception 'Use move_project_to_org to move a project to another organization';
  end if;
  if (new.name, new.description, new.working_days, new.client_id)
       is distinct from (old.name, old.description, old.working_days, old.client_id)
     and public.project_role(old.id, auth.uid()) is distinct from 'owner' then
    raise exception 'Only project owners can change the project''s settings';
  end if;
  return new;
end $$;
create trigger projects_guard_update before update on public.projects
  for each row execute function public.guard_project_update();

-- New project in an org I'm a member of (not a guest); p_org_id null means my
-- personal org. The creator also gets an own owner role.
drop function public.create_project(text, text);
create function public.create_project(p_name text, p_description text default null, p_org_id uuid default null)
returns public.projects
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_project public.projects;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  v_org := coalesce(p_org_id, public.ensure_personal_org(auth.uid()));
  if not public.is_org_member(v_org, 'member') then
    raise exception 'Only members of this organization can create projects in it';
  end if;
  insert into public.projects (name, description, created_by, org_id)
  values (p_name, p_description, auth.uid(), v_org)
  returning * into v_project;
  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, auth.uid(), 'owner');
  return v_project;
end $$;

-- Move a project I own into another org I'm a member of. People with an own
-- role come along (as guests if they aren't in the target org); a client from
-- the old org is unlinked. I keep owner via an own role.
create function public.move_project_to_org(p_project uuid, p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_from uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select p.org_id into v_from from public.projects p where p.id = p_project and p.deleted_at is null;
  if v_from is null then raise exception 'Project not found'; end if;
  if public.project_role(p_project, auth.uid()) is distinct from 'owner' then
    raise exception 'Only project owners can move a project';
  end if;
  if not public.is_org_member(p_org, 'member') then
    raise exception 'You can only move a project into an organization you are a member of';
  end if;
  if v_from = p_org then return; end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project, auth.uid(), 'owner')
  on conflict (project_id, user_id) do update set role = 'owner';

  perform set_config('app.project_move', 'on', true);
  update public.projects p
     set org_id = p_org,
         client_id = case
           when exists (select 1 from public.clients c where c.id = p.client_id and c.org_id = p_org)
           then p.client_id
         end
   where p.id = p_project;
  perform set_config('app.project_move', 'off', true);

  insert into public.org_members (org_id, user_id, role)
  select p_org, pm.user_id, 'guest' from public.project_members pm where pm.project_id = p_project
  on conflict (org_id, user_id) do nothing;
end $$;

-- Deleted projects I own, with their org so the page can show the current one's.
drop function public.deleted_projects_list();
create function public.deleted_projects_list()
returns table (
  id uuid, org_id uuid, name text, description text,
  deleted_at timestamptz, deleted_by uuid, deleted_by_name text
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.org_id, p.name, p.description, p.deleted_at, p.deleted_by,
         public.user_display_name(p.deleted_by)
    from public.projects p
   where p.deleted_at is not null
     and public.project_role(p.id, auth.uid()) = 'owner'
   order by p.deleted_at desc;
$$;

-- Clockify import: "add missing people" now means people of the project's org
-- (guests without access to that project) instead of teammates.
create or replace function public.import_time_entries(p_source text, p_batch uuid, p_rows jsonb, p_add_members boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_uid      uuid := auth.uid();
  r          jsonb;
  v_key      text;
  v_user     uuid;
  v_project  uuid;
  v_wi       uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_id       uuid;
  v_inserted int := 0;
  v_dupes    int := 0;
  v_added    int := 0;
  v_errors   jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_source), '') = '' then raise exception 'Import source required'; end if;
  if p_batch is null then raise exception 'Import batch required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1000 rows per call'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_key := nullif(trim(r->>'key'), '');
    begin
      v_user    := (r->>'user_id')::uuid;
      v_project := (r->>'project_id')::uuid;
      v_wi      := nullif(r->>'work_item_id', '')::uuid;
      v_start   := (r->>'start_at')::timestamptz;
      v_end     := (r->>'end_at')::timestamptz;

      if v_key is null or v_user is null or v_project is null or v_start is null or v_end is null then
        v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'missing_fields');
        continue;
      end if;
      if v_end <= v_start then
        v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'invalid_range');
        continue;
      end if;
      if not public.is_member(v_project, 'editor') then
        v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'not_editor');
        continue;
      end if;

      if public.project_role(v_project, v_user) is null then
        if p_add_members
           and public.is_member(v_project, 'owner')
           and exists (
             select 1 from public.org_members om
             join public.projects p on p.org_id = om.org_id
             where p.id = v_project and om.user_id = v_user
           )
        then
          insert into public.project_members(project_id, user_id, role)
          values (v_project, v_user, 'editor')
          on conflict (project_id, user_id) do nothing;
          v_added := v_added + 1;
        else
          v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'not_member');
          continue;
        end if;
      end if;

      if v_wi is not null and not exists (
        select 1 from public.work_items
         where id = v_wi and project_id = v_project and deleted_at is null
      ) then
        v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'bad_work_item');
        continue;
      end if;

      v_id := null;
      insert into public.time_entries(
        user_id, project_id, work_item_id, custom_task_text, notes,
        start_at, end_at, import_source, import_key, import_batch, imported_by
      )
      values (
        v_user, v_project, v_wi,
        nullif(trim(r->>'custom_task_text'), ''),
        nullif(trim(r->>'notes'), ''),
        v_start, v_end, p_source, v_key, p_batch, v_uid
      )
      on conflict (import_source, import_key) where import_key is not null do nothing
      returning id into v_id;

      if v_id is null then
        v_dupes := v_dupes + 1;
      else
        v_inserted := v_inserted + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('key', v_key, 'reason', 'error', 'detail', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'duplicates', v_dupes,
    'members_added', v_added,
    'errors', v_errors
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 5. Policies that changed
-- ---------------------------------------------------------------------
-- New projects only by org members (create_project is the normal route).
drop policy projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (created_by = auth.uid() and public.is_org_member(org_id, 'member'));

-- Only project owners add people. The old "first row of an empty project"
-- clause is gone: with org access a project can have no own rows at all, and
-- that clause would let anyone make themselves its owner.
drop policy pm_insert on public.project_members;
create policy pm_insert on public.project_members for insert to authenticated
  with check (public.is_member(project_id, 'owner'));

-- Org tables are written only through the RPCs below. Org details (with the
-- invite code) are for owners/admins; everyone else uses my_orgs_list().
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id, 'admin'));
create policy org_members_select on public.org_members for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(org_id, 'member'));

-- Clients: org members see and add them; org owners/admins (or whoever added
-- one) rename and delete. A project's members — guests too — see its client.
drop policy clients_select on public.clients;
drop policy clients_insert on public.clients;
drop policy clients_update on public.clients;
drop policy clients_delete on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (
    deleted_at is null
    and (
      public.is_org_member(org_id, 'member')
      or exists (select 1 from public.projects p where p.client_id = clients.id and public.is_member(p.id))
    )
  );
create policy clients_insert on public.clients for insert to authenticated
  with check (created_by = auth.uid() and public.is_org_member(org_id, 'member'));
create policy clients_update on public.clients for update to authenticated
  using (public.is_org_member(org_id, 'admin') or (created_by = auth.uid() and public.is_org_member(org_id, 'member')))
  with check (public.is_org_member(org_id, 'admin') or (created_by = auth.uid() and public.is_org_member(org_id, 'member')));
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_org_member(org_id, 'admin') or (created_by = auth.uid() and public.is_org_member(org_id, 'member')));

-- ---------------------------------------------------------------------
-- 6. Clients
-- ---------------------------------------------------------------------
drop function public.create_client(text, uuid);
create function public.create_client(p_name text, p_org_id uuid)
returns public.clients
language plpgsql set search_path = public
as $$
declare
  v_row public.clients;
  v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_name is null then raise exception 'Client name required'; end if;
  if not public.is_org_member(p_org_id, 'member') then
    raise exception 'Only members of this organization can add clients to it';
  end if;
  insert into public.clients (name, org_id, created_by)
  values (v_name, p_org_id, auth.uid())
  returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception 'A client with this name already exists in this organization';
end $$;

create or replace function public.can_see_client(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id
       and c.deleted_at is null
       and (
         public.is_org_member(c.org_id, 'member')
         or exists (select 1 from public.projects p where p.client_id = c.id and public.is_member(p.id))
       )
  );
$$;

create or replace function public.set_project_client(p_project_id uuid, p_client_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_member(p_project_id, 'owner') then
    raise exception 'Only the project owner can change the client';
  end if;
  if p_client_id is not null then
    if not public.can_see_client(p_client_id) then
      raise exception 'Client not accessible';
    end if;
    if not exists (
      select 1 from public.clients c join public.projects p on p.org_id = c.org_id
       where c.id = p_client_id and p.id = p_project_id
    ) then
      raise exception 'That client belongs to another organization';
    end if;
  end if;
  update public.projects set client_id = p_client_id where id = p_project_id;
end $$;

-- A project's client name. With org-scoped clients the caller's own RLS
-- already lets every project member read it, so this no longer needs to run
-- as its owner (it used to, for the private/team scope label).
drop view public.project_client_view;
create view public.project_client_view with (security_invoker = on) as
  select p.id as project_id, c.id as client_id, c.name as client_name
    from public.projects p
    join public.clients c on c.id = p.client_id and c.deleted_at is null
   where public.is_member(p.id);
grant select on public.project_client_view to authenticated;

-- ---------------------------------------------------------------------
-- 7. Organization RPCs
-- ---------------------------------------------------------------------
-- My orgs (guests included). The invite code only for owners/admins.
create function public.my_orgs_list()
returns table (
  id uuid, name text, description text, is_personal boolean, my_role text,
  invite_code text, member_count int, guest_count int, project_count int,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    o.id, o.name, o.description, o.is_personal, me.role,
    case when me.role in ('owner', 'admin') and not o.is_personal then o.invite_code end,
    (select count(*)::int from public.org_members m where m.org_id = o.id and m.role <> 'guest'),
    (select count(*)::int from public.org_members m where m.org_id = o.id and m.role = 'guest'),
    (select count(*)::int from public.projects p
      where p.org_id = o.id and p.deleted_at is null and public.is_member(p.id)),
    o.created_at
  from public.organizations o
  join public.org_members me on me.org_id = o.id and me.user_id = auth.uid()
  order by o.is_personal, lower(o.name);
$$;

-- My personal org's id, creating it if it is somehow missing.
create function public.my_personal_org()
returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return public.ensure_personal_org(auth.uid());
end $$;

-- People of an org, for its members (guests get nothing). projects = the
-- person's own project roles in the org — for a guest, exactly what they can see.
create function public.org_members_list(p_org uuid)
returns table (
  user_id uuid, role text, joined_at timestamptz,
  email text, first_name text, last_name text, display_name text,
  projects jsonb
)
language sql stable security definer set search_path = public
as $$
  select
    m.user_id,
    m.role,
    m.joined_at,
    u.email::text,
    s.first_name,
    s.last_name,
    coalesce(
      nullif(trim(both from concat_ws(' ', s.first_name, s.last_name)), ''),
      split_part(u.email::text, '@', 1)
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', pm.role) order by lower(p.name))
        from public.project_members pm
        join public.projects p on p.id = pm.project_id
       where pm.user_id = m.user_id and p.org_id = p_org and p.deleted_at is null
    ), '[]'::jsonb)
  from public.org_members m
  join auth.users u on u.id = m.user_id
  left join public.user_settings s on s.user_id = m.user_id
  where m.org_id = p_org
    and public.is_org_member(p_org, 'member');
$$;

create function public.create_organization(p_name text, p_description text default null)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_org public.organizations;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_name is null then raise exception 'Organization name required'; end if;
  insert into public.organizations (name, description, created_by)
  values (v_name, nullif(trim(p_description), ''), auth.uid())
  returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  return v_org;
end $$;

create function public.update_organization(p_org uuid, p_name text, p_description text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text := nullif(trim(p_name), '');
begin
  if not public.is_org_member(p_org, 'admin') then
    raise exception 'Only owners and admins can edit an organization';
  end if;
  if exists (select 1 from public.organizations where id = p_org and is_personal) then
    raise exception 'Your personal organization cannot be renamed';
  end if;
  if v_name is null then raise exception 'Organization name required'; end if;
  update public.organizations
     set name = v_name, description = nullif(trim(p_description), '')
   where id = p_org;
end $$;

-- Only an empty org: projects (also those in the bin) must be moved out first.
-- Its clients go with it.
create function public.delete_organization(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_active int; v_binned int;
begin
  if not public.is_org_member(p_org, 'owner') then
    raise exception 'Only owners can delete an organization';
  end if;
  if exists (select 1 from public.organizations where id = p_org and is_personal) then
    raise exception 'Your personal organization cannot be deleted';
  end if;
  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    into v_active, v_binned
    from public.projects where org_id = p_org;
  if v_active + v_binned > 0 then
    raise exception 'This organization still has % project(s) (% of them deleted). Move them to another organization first.',
      v_active + v_binned, v_binned;
  end if;
  delete from public.clients where org_id = p_org;
  delete from public.organizations where id = p_org;
end $$;

create function public.regenerate_org_invite_code(p_org uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_code text;
begin
  if not public.is_org_member(p_org, 'admin') then
    raise exception 'Only owners and admins can change the invite code';
  end if;
  if exists (select 1 from public.organizations where id = p_org and is_personal) then
    raise exception 'A personal organization has no invite code';
  end if;
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  update public.organizations set invite_code = v_code where id = p_org;
  return v_code;
end $$;

-- Join as a member. A guest who gets the code becomes a member.
create function public.join_org_by_code(p_code text)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_org public.organizations;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_org from public.organizations
   where invite_code = trim(p_code) and not is_personal;
  if v_org.id is null then raise exception 'Invalid invite code'; end if;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'member')
  on conflict (org_id, user_id) do update set role = 'member' where org_members.role = 'guest';
  return json_build_object('id', v_org.id, 'name', v_org.name);
end $$;

-- Owners change roles. An org always keeps at least one owner.
create function public.set_org_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  if p_role not in ('owner', 'admin', 'member', 'guest') then raise exception 'Invalid role'; end if;
  if not public.is_org_member(p_org, 'owner') then
    raise exception 'Only owners can change roles';
  end if;
  if exists (select 1 from public.organizations where id = p_org and is_personal) then
    raise exception 'Roles in a personal organization cannot be changed';
  end if;
  perform 1 from public.organizations where id = p_org for update;  -- one role change at a time
  select role into v_old from public.org_members where org_id = p_org and user_id = p_user;
  if v_old is null then raise exception 'Not a member of this organization'; end if;
  if v_old = 'owner' and p_role <> 'owner'
     and (select count(*) from public.org_members where org_id = p_org and role = 'owner') = 1 then
    raise exception 'An organization needs at least one owner';
  end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user;
end $$;

-- Remove someone (owners anyone, admins members and guests) or leave myself.
-- Their own project roles in the org go with them (org_members_cleanup).
create function public.remove_org_member(p_org uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target text;
  v_me text;
  v_personal boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select is_personal into v_personal from public.organizations where id = p_org for update;
  if v_personal is null then raise exception 'Organization not found'; end if;
  select role into v_target from public.org_members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'Not a member of this organization'; end if;
  select role into v_me from public.org_members where org_id = p_org and user_id = auth.uid();

  if p_user = auth.uid() then
    if v_personal then raise exception 'You cannot leave your personal organization'; end if;
    if v_target = 'owner'
       and (select count(*) from public.org_members where org_id = p_org and role = 'owner') = 1 then
      raise exception 'You are the last owner. Make someone else an owner first, or delete the organization.';
    end if;
  elsif v_me = 'owner' then
    null;  -- any one else; there is still an owner (me)
  elsif v_me = 'admin' then
    if v_target in ('owner', 'admin') then
      raise exception 'Admins can only remove members and guests';
    end if;
  else
    raise exception 'Only owners and admins can remove people';
  end if;

  delete from public.org_members where org_id = p_org and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 8. Personal org for every new user
-- ---------------------------------------------------------------------
-- Never blocks a sign-up: if this fails, my_personal_org() creates it later.
create function public.handle_new_user_org()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    perform public.ensure_personal_org(new.id);
  exception when others then
    raise warning 'personal organization for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $$;
create trigger on_auth_user_created_org after insert on auth.users
  for each row execute function public.handle_new_user_org();

-- ---------------------------------------------------------------------
-- 9. Grants: RPCs for signed-in users only; internals for nobody.
-- ---------------------------------------------------------------------
revoke execute on function public.org_role(uuid, uuid)                 from public, anon, authenticated;
revoke execute on function public.ensure_personal_org(uuid)            from public, anon, authenticated;
revoke execute on function public.project_members_ensure_org()         from public, anon, authenticated;
revoke execute on function public.org_members_cleanup()                from public, anon, authenticated;
revoke execute on function public.guard_project_update()               from public, anon, authenticated;
revoke execute on function public.handle_new_user_org()               from public, anon, authenticated;

revoke execute on function public.is_org_member(uuid, text)            from public, anon;
revoke execute on function public.project_members_list(uuid)           from public, anon;
revoke execute on function public.org_project_members(uuid)            from public, anon;
revoke execute on function public.create_project(text, text, uuid)     from public, anon;
revoke execute on function public.move_project_to_org(uuid, uuid)      from public, anon;
revoke execute on function public.deleted_projects_list()              from public, anon;
revoke execute on function public.create_client(text, uuid)            from public, anon;
revoke execute on function public.my_orgs_list()                       from public, anon;
revoke execute on function public.my_personal_org()                    from public, anon;
revoke execute on function public.org_members_list(uuid)               from public, anon;
revoke execute on function public.create_organization(text, text)      from public, anon;
revoke execute on function public.update_organization(uuid, text, text) from public, anon;
revoke execute on function public.delete_organization(uuid)            from public, anon;
revoke execute on function public.regenerate_org_invite_code(uuid)     from public, anon;
revoke execute on function public.join_org_by_code(text)               from public, anon;
revoke execute on function public.set_org_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.remove_org_member(uuid, uuid)        from public, anon;

grant execute on function public.is_org_member(uuid, text)             to authenticated;
grant execute on function public.project_members_list(uuid)            to authenticated;
grant execute on function public.org_project_members(uuid)             to authenticated;
grant execute on function public.create_project(text, text, uuid)      to authenticated;
grant execute on function public.move_project_to_org(uuid, uuid)       to authenticated;
grant execute on function public.deleted_projects_list()               to authenticated;
grant execute on function public.create_client(text, uuid)             to authenticated;
grant execute on function public.my_orgs_list()                        to authenticated;
grant execute on function public.my_personal_org()                     to authenticated;
grant execute on function public.org_members_list(uuid)                to authenticated;
grant execute on function public.create_organization(text, text)       to authenticated;
grant execute on function public.update_organization(uuid, text, text) to authenticated;
grant execute on function public.delete_organization(uuid)             to authenticated;
grant execute on function public.regenerate_org_invite_code(uuid)      to authenticated;
grant execute on function public.join_org_by_code(text)                to authenticated;
grant execute on function public.set_org_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_org_member(uuid, uuid)         to authenticated;


-- ===================== teams_drop.sql =====================
-- =====================================================================
-- Organizations replace teams (step 2 of 2). Run after organizations.sql,
-- once the new app is live: removes everything that only served teams.
--
--   * teams, team_members, team_shares, project_teams and their RPCs
--   * clients.owner_user_id / clients.team_id (clients belong to an org now)
--   * the 'project_team' branch of the audit trigger
--
-- audit_log keeps its 'project_team' entity type: old rows still use it.
-- =====================================================================


-- Audit trigger without project_teams.
create or replace function public.log_changes()
returns trigger
language plpgsql security definer set search_path = public
as $function$
declare
  proj  uuid;
  ent   uuid;
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  id_key text := case tg_argv[0] when 'project_member' then 'user_id' else 'id' end;
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

-- Team RPCs.
drop function public.add_team_to_project(uuid, uuid, text);
drop function public.add_user_to_project_from_team(uuid, uuid, text);
drop function public.project_teams_list(uuid);
drop function public.shared_teams_list();
drop function public.team_shares_list(uuid);
drop function public.team_members_list(uuid);
drop function public.my_teams_list();
drop function public.join_team_by_code(text);
drop function public.create_team(text, text);
drop function public.regenerate_team_invite_code(uuid);
drop function public.promote_client_to_team(uuid, uuid);
drop function public.my_visible_clients();
drop function public.can_view_team(uuid);

-- Team tables (their policies, triggers and indexes go with them).
drop table public.project_teams;
drop table public.team_shares;
alter table public.clients drop column team_id, drop column owner_user_id;
drop table public.team_members;
drop table public.teams;

-- Last: the team tables' policies used it.
drop function public.is_team_member(uuid, text);


-- =====================================================================
-- Tests (run as real users under RLS), then roll everything back.
-- =====================================================================
do $test$
declare
  v_nelis    uuid := '6113ceaa-de3c-493e-a09a-986f60dc7d3b';  -- Bestuur -> owner
  v_heinrich uuid := 'd8962d5a-058d-4712-9f11-4c41c43621e9';  -- CreoX member, no own project roles
  v_roelof   uuid := '1f4aeb31-46aa-43e8-9ed7-ef6a2561ff42';  -- CreoX member with own editor roles
  v_adriaan  uuid := 'c1306d40-9e89-4789-b6ec-4a731692f760';  -- CreoX Guests, editor on one project
  v_marc     uuid := '48c7f01b-3eba-47e5-90e6-b85cf77f0395';  -- in no team, editor on one project
  v_creox    uuid;
  v_code     text;
  p_toets1   uuid;
  p_roelof   uuid;
  p_rondom   uuid;
  p_new      uuid;
  v_org      uuid;
  v_hcode    text;
  out jsonb := '{}'::jsonb;
  k int; ok boolean; s text; j jsonb;
begin
  select id, invite_code into v_creox, v_code from organizations where name = 'CreoX' and not is_personal;
  select id into p_toets1 from projects where name = 'Toets1';
  select id into p_rondom from projects where name = 'RondomTalie';
  select pm.project_id into p_roelof from project_members pm join projects prj on prj.id = pm.project_id
   where pm.user_id = v_roelof and pm.role = 'editor' and prj.deleted_at is null and prj.created_by <> v_roelof
   order by prj.name limit 1;

  -- 0. Nobody lost or dropped a level; who gained.
  select count(*) into k from _before b
   where b.role is not null and project_role(b.project_id, b.user_id) is null;
  out := out || jsonb_build_object('0_lost_access', k);
  select count(*) into k from _before b
   where b.role is not null
     and (case project_role(b.project_id, b.user_id) when 'owner' then 0 when 'editor' then 1 when 'viewer' then 2 else 3 end)
       > (case b.role when 'owner' then 0 when 'editor' then 1 when 'viewer' then 2 else 3 end);
  out := out || jsonb_build_object('0_downgraded', k);
  select jsonb_agg(x) into j from (
    select user_display_name(b.user_id) || ' @ ' || (select name from projects where id = b.project_id)
           || ': ' || b.role || ' -> ' || coalesce(project_role(b.project_id, b.user_id), 'none') as x
      from _before b
     where b.role is not null
       and (case project_role(b.project_id, b.user_id) when 'owner' then 0 when 'editor' then 1 when 'viewer' then 2 else 3 end)
         > (case b.role when 'owner' then 0 when 'editor' then 1 when 'viewer' then 2 else 3 end)
     limit 5) q;
  out := out || jsonb_build_object('0_downgraded_sample', j);
  select jsonb_object_agg(r, c) into j from (
    select coalesce(project_role(b.project_id, b.user_id), 'none') r, count(*) c
      from _before b where b.role is null group by 1) q;
  out := out || jsonb_build_object('0_gained_by_role', j);

  -- 1. Shape of the port.
  select jsonb_build_object(
    'orgs', (select count(*) from organizations),
    'personal', (select count(*) from organizations where is_personal),
    'users', (select count(*) from auth.users),
    'creox_roles', (select jsonb_object_agg(role, c) from (select role, count(*) c from org_members where org_id = v_creox group by role) q),
    'projects_no_org', (select count(*) from projects where org_id is null),
    'projects_creox', (select count(*) from projects where org_id = v_creox),
    'clients_creox', (select count(*) from clients where org_id = v_creox),
    'code_kept', v_code is not null
  ) into j;
  out := out || jsonb_build_object('1_port', j);

  -- 2. Heinrich, member: edits every project, owns none he didn't make, can create.
  perform set_config('request.jwt.claims', json_build_object('sub', v_heinrich, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into k from projects;
  out := out || jsonb_build_object('2_visible_projects', k);
  out := out || jsonb_build_object('2_toets1_view', is_member(p_toets1), '2_toets1_edit', is_member(p_toets1, 'editor'));
  select invite_code into s from my_orgs_list() where id = v_creox;
  out := out || jsonb_build_object('2_orgs', (select count(*) from my_orgs_list()), '2_member_sees_code', s is not null);
  out := out || jsonb_build_object('2_org_members_list', (select count(*) from org_members_list(v_creox)));
  select count(*) into k from org_project_members(v_creox);
  out := out || jsonb_build_object('2_org_project_members_rows', k);
  begin
    select id into p_new from create_project('Dryrun H', null, v_creox);
    out := out || jsonb_build_object('2_create_project', 'ok');
  exception when others then out := out || jsonb_build_object('2_create_project', 'blocked: ' || sqlerrm); end;
  begin
    update projects set name = name || ' x' where id = p_toets1;
    out := out || jsonb_build_object('2_rename_unowned', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('2_rename_unowned', 'blocked'); end;
  begin
    perform start_time_entry(p_toets1, null, null, null);
    out := out || jsonb_build_object('2_track_time', 'ok');
  exception when others then out := out || jsonb_build_object('2_track_time', 'blocked: ' || sqlerrm); end;
  select count(*) into k from clients;
  out := out || jsonb_build_object('2_clients_visible', k);
  begin
    perform create_client('Dryrun client', v_creox);
    out := out || jsonb_build_object('2_create_client', 'ok');
  exception when others then out := out || jsonb_build_object('2_create_client', 'blocked: ' || sqlerrm); end;
  begin
    insert into project_members (project_id, user_id, role) values (p_toets1, v_heinrich, 'owner');
    out := out || jsonb_build_object('2_self_owner', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('2_self_owner', 'blocked'); end;
  begin
    perform move_project_to_org(p_toets1, v_creox);
    out := out || jsonb_build_object('2_move_unowned', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('2_move_unowned', 'blocked'); end;
  reset role;
  out := out || jsonb_build_object('2_new_project_role', project_role(p_new, v_heinrich));

  -- 3. Roelof, editor: may complete, may not change settings or the creator.
  perform set_config('request.jwt.claims', json_build_object('sub', v_roelof, 'role', 'authenticated')::text, true);
  set local role authenticated;
  out := out || jsonb_build_object('3_project', (select name from projects where id = p_roelof));
  begin
    update projects set name = name || ' x' where id = p_roelof;
    out := out || jsonb_build_object('3_editor_rename', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('3_editor_rename', 'blocked'); end;
  begin
    update projects set created_by = v_roelof where id = p_roelof;
    out := out || jsonb_build_object('3_steal_creator', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('3_steal_creator', 'blocked'); end;
  begin
    update projects set org_id = (select id from organizations where is_personal and created_by = v_roelof) where id = p_roelof;
    out := out || jsonb_build_object('3_raw_org_change', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('3_raw_org_change', 'blocked'); end;
  update projects set completed_at = now() where id = p_roelof;
  get diagnostics k = row_count;
  out := out || jsonb_build_object('3_editor_complete_rows', k);
  reset role;

  -- 4. Adriaan, guest: only his project, can't create in CreoX, can in Personal.
  perform set_config('request.jwt.claims', json_build_object('sub', v_adriaan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into k from projects;
  out := out || jsonb_build_object('4_visible_projects', k);
  select my_role, invite_code into s, v_hcode from my_orgs_list() where id = v_creox;
  out := out || jsonb_build_object('4_role', s, '4_guest_sees_code', v_hcode is not null);
  out := out || jsonb_build_object('4_org_members_list', (select count(*) from org_members_list(v_creox)));
  out := out || jsonb_build_object('4_org_table_rows', (select count(*) from organizations));
  begin
    perform create_project('Dryrun A', null, v_creox);
    out := out || jsonb_build_object('4_create_in_creox', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('4_create_in_creox', 'blocked'); end;
  begin
    perform create_project('Dryrun A personal', null, null);
    out := out || jsonb_build_object('4_create_personal', 'ok');
  exception when others then out := out || jsonb_build_object('4_create_personal', 'blocked: ' || sqlerrm); end;
  out := out || jsonb_build_object(
    '4_clients_visible', (select count(*) from clients),
    '4_client_view_rows', (select count(*) from project_client_view),
    '4_members_of_his_project', (select count(*) from project_members_list((select id from projects where name = 'D221201-T100')))
  );
  begin
    perform create_client('Guest client', v_creox);
    out := out || jsonb_build_object('4_create_client', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('4_create_client', 'blocked'); end;
  reset role;

  -- 5. Nelis, owner: roles, removal, guests via project roles, guards.
  perform set_config('request.jwt.claims', json_build_object('sub', v_nelis, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select invite_code into s from my_orgs_list() where id = v_creox;
  out := out || jsonb_build_object('5_owner_sees_code', s is not null);
  perform set_org_member_role(v_creox, v_heinrich, 'admin');
  reset role;
  out := out || jsonb_build_object('5_admin_role_on_toets1', project_role(p_toets1, v_heinrich));
  set local role authenticated;
  perform set_org_member_role(v_creox, v_heinrich, 'member');
  perform remove_org_member(v_creox, v_marc);
  reset role;
  out := out || jsonb_build_object(
    '5_removed_marc_role', coalesce(project_role(p_rondom, v_marc), 'none'),
    '5_removed_marc_rows', (select count(*) from project_members pm join projects p on p.id = pm.project_id
                             where pm.user_id = v_marc and p.org_id = v_creox)
  );
  set local role authenticated;
  insert into project_members (project_id, user_id, role) values (p_rondom, v_marc, 'viewer');
  reset role;
  out := out || jsonb_build_object('5_readded_marc_org_role', org_role(v_creox, v_marc));
  set local role authenticated;
  begin
    perform delete_organization((select id from my_orgs_list() where is_personal));
    out := out || jsonb_build_object('5_delete_personal', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('5_delete_personal', 'blocked'); end;
  begin
    perform delete_organization(v_creox);
    out := out || jsonb_build_object('5_delete_creox', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('5_delete_creox', 'blocked: ' || sqlerrm); end;
  out := out || jsonb_build_object(
    '5_bin', (select count(*) from deleted_projects_list() where org_id = v_creox)
  );
  reset role;

  -- 6. A new org: last-owner rules, join by code, removal, delete.
  perform set_config('request.jwt.claims', json_build_object('sub', v_heinrich, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_org from create_organization('Dryrun org', 'test');
  begin
    perform set_org_member_role(v_org, v_heinrich, 'member');
    out := out || jsonb_build_object('6_demote_last_owner', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('6_demote_last_owner', 'blocked'); end;
  begin
    perform remove_org_member(v_org, v_heinrich);
    out := out || jsonb_build_object('6_last_owner_leave', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('6_last_owner_leave', 'blocked'); end;
  s := regenerate_org_invite_code(v_org);
  select invite_code into v_hcode from organizations where is_personal and created_by = v_heinrich;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adriaan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform join_org_by_code(s);
  begin
    perform join_org_by_code(v_hcode);
    out := out || jsonb_build_object('6_join_personal', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('6_join_personal', 'blocked'); end;
  -- 7. The CreoX code turns the guest into a member.
  perform join_org_by_code(v_code);
  select count(*) into k from projects;
  out := out || jsonb_build_object('7_after_join_visible_projects', k,
    '7_role', (select my_role from my_orgs_list() where id = v_creox));
  reset role;
  out := out || jsonb_build_object('6_joined_role', org_role(v_org, v_adriaan));

  perform set_config('request.jwt.claims', json_build_object('sub', v_heinrich, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform remove_org_member(v_org, v_adriaan);
  begin
    perform delete_organization(v_org);
    out := out || jsonb_build_object('6_delete_empty_org', 'ok');
  exception when others then out := out || jsonb_build_object('6_delete_empty_org', 'blocked: ' || sqlerrm); end;

  -- 8. Move a personal project into CreoX.
  select id into p_new from create_project('Dryrun move', null, null);
  perform move_project_to_org(p_new, v_creox);
  reset role;
  out := out || jsonb_build_object(
    '8_moved_org_is_creox', (select org_id from projects where id = p_new) = v_creox,
    '8_mover_role', project_role(p_new, v_heinrich)
  );

  -- 9. A new sign-up gets a personal org.
  begin
    insert into auth.users (id, email, aud, role)
    values ('00000000-0000-4000-8000-0000000d1d1d', 'dryrun-org@example.invalid', 'authenticated', 'authenticated');
    out := out || jsonb_build_object('9_new_user_personal_org',
      (select count(*) from org_members m join organizations o on o.id = m.org_id
        where m.user_id = '00000000-0000-4000-8000-0000000d1d1d' and o.is_personal and m.role = 'owner'));
  exception when others then out := out || jsonb_build_object('9_new_user', 'error: ' || sqlerrm); end;

  raise exception 'DRYRUN %', out;
end
$test$;

-- Expected:
--   0_lost_access 0, 0_downgraded 0, 0_gained_by_role {"editor": 432, "owner": 8, "none": 134}
--     (members now edit every project; the other Bestuur owners gain Toets1/Toets2;
--      "none" = guests on projects not shared with them)
--   1_port: personal = users, creox_roles {"owner":5,"member":11,"guest":3},
--           projects_no_org 0, projects_creox 46, clients_creox 8, code_kept true
--   2: visible 44, toets1 view true / edit true, orgs 2, member_sees_code false,
--      org_members_list 19, create_project ok, rename_unowned blocked, track_time ok,
--      clients_visible 8, create_client ok, self_owner blocked, move_unowned blocked,
--      new_project_role owner
--   3: editor_rename blocked, steal_creator blocked, raw_org_change blocked, editor_complete_rows 1
--   4: visible 1, role guest, guest_sees_code false, org_members_list 0,
--      org_table_rows 1 (only his own Personal org, which he owns),
--      create_in_creox blocked, create_personal ok, clients_visible 1, client_view_rows 1,
--      members_of_his_project > 0, create_client blocked
--   5: owner_sees_code true, admin_role_on_toets1 owner, removed_marc_role none,
--      removed_marc_rows 0, readded_marc_org_role guest, delete_personal blocked,
--      delete_creox blocked, bin 2
--   6: demote_last_owner blocked, last_owner_leave blocked, join_personal blocked,
--      joined_role member, delete_empty_org ok
--   7: after_join_visible_projects 46 (44 CreoX + "Dryrun H" from step 2 + his own personal one),
--      role member
--   8: moved_org_is_creox true, mover_role owner
--   9: new_user_personal_org 1
