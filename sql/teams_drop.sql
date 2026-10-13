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

begin;

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

commit;
