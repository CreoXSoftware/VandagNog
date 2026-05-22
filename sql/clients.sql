-- =====================================================================
-- Clients feature
-- Run in Supabase SQL editor. Idempotent where possible.
-- Requires: public.teams (id), public.team_members(team_id, user_id, role),
--           public.projects, public.project_members, public.user_settings,
--           helper public.is_member(uuid, text).
-- =====================================================================

-- 1. Table -----------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  owner_user_id uuid references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- exactly one scope
  constraint clients_scope_xor check (
    (owner_user_id is not null and team_id is null)
    or (owner_user_id is null and team_id is not null)
  )
);

create index if not exists clients_owner_idx on public.clients(owner_user_id)
  where owner_user_id is not null and deleted_at is null;
create index if not exists clients_team_idx on public.clients(team_id)
  where team_id is not null and deleted_at is null;

-- Case-insensitive uniqueness per scope (private list of one user, or team list)
create unique index if not exists clients_unique_private
  on public.clients (owner_user_id, lower(name))
  where team_id is null and deleted_at is null;

create unique index if not exists clients_unique_team
  on public.clients (team_id, lower(name))
  where owner_user_id is null and deleted_at is null;

-- touch updated_at
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- 2. Project link ----------------------------------------------------
alter table public.projects
  add column if not exists client_id uuid references public.clients(id) on delete restrict;

create index if not exists projects_client_idx on public.projects(client_id)
  where client_id is not null;

-- 3. Helpers ---------------------------------------------------------

create or replace function public.is_team_member(p_team uuid, p_min_role text default 'member')
returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team
       and user_id = auth.uid()
       and case p_min_role
             when 'owner' then role = 'owner'
             else true
           end
  );
$$;

grant execute on function public.is_team_member(uuid, text) to authenticated;

-- Can current user see this client?
-- Visible if: private and owned by me; or team-scoped and I'm in the team;
-- or it's linked to a project I'm a member of.
create or replace function public.can_see_client(p_client_id uuid)
returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client_id
       and c.deleted_at is null
       and (
         c.owner_user_id = auth.uid()
         or (c.team_id is not null and public.is_team_member(c.team_id))
         or exists (
           select 1
             from public.projects p
             join public.project_members pm on pm.project_id = p.id
            where p.client_id = c.id
              and pm.user_id = auth.uid()
         )
       )
  );
$$;

grant execute on function public.can_see_client(uuid) to authenticated;

-- 4. RLS -------------------------------------------------------------
alter table public.clients enable row level security;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select
  using (
    deleted_at is null
    and (
      owner_user_id = auth.uid()
      or (team_id is not null and public.is_team_member(team_id))
      or exists (
        select 1
          from public.projects p
          join public.project_members pm on pm.project_id = p.id
         where p.client_id = clients.id
           and pm.user_id = auth.uid()
      )
    )
  );

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert
  with check (
    created_by = auth.uid()
    and (
      (team_id is null and owner_user_id = auth.uid())
      or (owner_user_id is null and team_id is not null and public.is_team_member(team_id))
    )
  );

-- Edit/delete: private = self; team = team owner only
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update
  using (
    (team_id is null and owner_user_id = auth.uid())
    or (team_id is not null and public.is_team_member(team_id, 'owner'))
  )
  with check (
    (team_id is null and owner_user_id = auth.uid())
    or (team_id is not null and public.is_team_member(team_id, 'owner'))
  );

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete
  using (
    (team_id is null and owner_user_id = auth.uid())
    or (team_id is not null and public.is_team_member(team_id, 'owner'))
  );

-- 5. RPCs ------------------------------------------------------------

-- Create a client. p_team_id null = private to caller.
create or replace function public.create_client(p_name text, p_team_id uuid default null)
returns public.clients
language plpgsql security invoker set search_path = public as $$
declare
  v_row public.clients;
  v_name text := nullif(trim(p_name), '');
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_name is null then raise exception 'Client name required'; end if;

  if p_team_id is null then
    insert into public.clients(name, owner_user_id, created_by)
      values (v_name, auth.uid(), auth.uid())
      returning * into v_row;
  else
    if not public.is_team_member(p_team_id) then
      raise exception 'Not a member of this team';
    end if;
    insert into public.clients(name, team_id, created_by)
      values (v_name, p_team_id, auth.uid())
      returning * into v_row;
  end if;

  return v_row;
exception when unique_violation then
  raise exception 'A client with this name already exists in that list';
end $$;

revoke all on function public.create_client(text, uuid) from public;
grant execute on function public.create_client(text, uuid) to authenticated;

-- Promote a private client to a team. Caller must own the private client
-- and be a member of the target team. Blocks on name conflict in target team.
create or replace function public.promote_client_to_team(p_client_id uuid, p_team_id uuid)
returns public.clients
language plpgsql security definer set search_path = public as $$
declare
  v_row public.clients;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_row from public.clients
   where id = p_client_id and deleted_at is null;
  if v_row.id is null then raise exception 'Client not found'; end if;
  if v_row.owner_user_id is null or v_row.owner_user_id <> auth.uid() then
    raise exception 'Only the owner of a private client can promote it';
  end if;
  if not public.is_team_member(p_team_id) then
    raise exception 'Not a member of target team';
  end if;

  if exists (
    select 1 from public.clients
     where team_id = p_team_id
       and lower(name) = lower(v_row.name)
       and deleted_at is null
  ) then
    raise exception 'A client named "%" already exists in that team', v_row.name;
  end if;

  update public.clients
     set owner_user_id = null,
         team_id = p_team_id
   where id = p_client_id
   returning * into v_row;

  return v_row;
end $$;

revoke all on function public.promote_client_to_team(uuid, uuid) from public;
grant execute on function public.promote_client_to_team(uuid, uuid) to authenticated;

-- Set or clear the client on a project. Project owner only.
-- Caller must be able to see the client (visibility rule).
create or replace function public.set_project_client(p_project_id uuid, p_client_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_member(p_project_id, 'owner') then
    raise exception 'Only the project owner can change the client';
  end if;
  if p_client_id is not null and not public.can_see_client(p_client_id) then
    raise exception 'Client not accessible';
  end if;

  update public.projects set client_id = p_client_id where id = p_project_id;
end $$;

revoke all on function public.set_project_client(uuid, uuid) from public;
grant execute on function public.set_project_client(uuid, uuid) to authenticated;

-- 6. Picker payload --------------------------------------------------
-- Returns clients the caller can pick from: their private + clients of every
-- team they belong to. Includes scope info so UI can group/label.
create or replace function public.my_visible_clients()
returns table (
  id uuid,
  name text,
  scope text,            -- 'private' | 'team'
  team_id uuid,
  team_name text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, 'private'::text, null::uuid, null::text
    from public.clients c
   where c.deleted_at is null
     and c.owner_user_id = auth.uid()
  union all
  select c.id, c.name, 'team'::text, t.id, t.name
    from public.clients c
    join public.teams t on t.id = c.team_id
    join public.team_members tm on tm.team_id = c.team_id and tm.user_id = auth.uid()
   where c.deleted_at is null
     and c.team_id is not null
  order by 3 desc, 2 asc;   -- team rows first, then alphabetical
$$;

grant execute on function public.my_visible_clients() to authenticated;

-- 7. Project-side display ------------------------------------------
-- Read-only view for project members to see a linked client's name and a
-- human-readable scope label, even when the project member cannot otherwise
-- see the client (private of someone else, or team they're not in).
drop view if exists public.project_client_view;
-- Definer view: needs to read auth.users for owner display_name. Caller-visibility
-- is gated by the EXISTS on project_members below.
create view public.project_client_view as
select
  p.id as project_id,
  c.id as client_id,
  c.name as client_name,
  case when c.owner_user_id is not null then 'private' else 'team' end as scope,
  c.team_id,
  t.name as team_name,
  c.owner_user_id,
  coalesce(
    nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
    split_part(u.email::text, '@', 1)
  ) as owner_display_name
from public.projects p
join public.clients c on c.id = p.client_id and c.deleted_at is null
left join public.teams t on t.id = c.team_id
left join auth.users u on u.id = c.owner_user_id
left join public.user_settings s on s.user_id = c.owner_user_id
where exists (
  select 1 from public.project_members pm
   where pm.project_id = p.id and pm.user_id = auth.uid()
);

grant select on public.project_client_view to authenticated;
