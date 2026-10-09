-- =====================================================================
-- Project role rule: HIGHEST WINS.
--
-- Replaces the rule from project_teams.sql ("own project_members row
-- overrides the team role, up or down"). A person's effective role is now the
-- highest of their own role and the roles of every linked team they are in.
-- Linking a team at a higher role therefore lifts people who already had a
-- lower individual role, with nothing to delete. An individual role can raise
-- someone above their team, but no longer lower them below it.
--
-- Checked against live data on 2026-10-09: the only roles that change are
-- Nelis Brink and Reinald Liebenberg on OmanG6 (editor -> owner, via the
-- CreoX Bestuur link). Highest-wins can only ever raise a role.
--
-- Same signatures as before, so policies, grants and callers are unchanged.
-- Run once in the Supabase SQL editor.
-- =====================================================================

begin;

create or replace function public.project_role(p_project uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r
    from (
      select pm.role as r
        from public.project_members pm
       where pm.project_id = p_project and pm.user_id = p_user
      union all
      select pt.role
        from public.project_teams pt
        join public.team_members tm on tm.team_id = pt.team_id
       where pt.project_id = p_project and tm.user_id = p_user
    ) roles
   order by case r when 'owner' then 0 when 'editor' then 1 else 2 end
   limit 1;
$function$;

create or replace function public.project_members_list(p_project uuid)
returns table(
  project_id   uuid,
  user_id      uuid,
  role         text,    -- effective role: highest of direct_role and team_role
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
           case
             when 'owner'  in (d.role, v.team_role) then 'owner'
             when 'editor' in (d.role, v.team_role) then 'editor'
             else coalesce(d.role, v.team_role)
           end                                  as role,
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

commit;
