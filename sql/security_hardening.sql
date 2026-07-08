-- Security hardening: keep SECURITY DEFINER RPCs off the anon (not-signed-in) role.
--
-- All of these functions rely on auth.uid() and are meant for signed-in users only.
-- Supabase auto-grants EXECUTE to anon/authenticated on new public functions, and
-- some functions also carry the default PUBLIC grant (which anon inherits), so a
-- role-specific `revoke from anon` alone is not always enough - revoke from PUBLIC
-- too and re-grant authenticated explicitly.
--
-- Clears Supabase advisor 0028 (anon_security_definer_function_executable).
-- Re-run these after (re)creating any of the functions below.

-- Functions that only needed anon stripped (authenticated grant already in place).
revoke execute on function public.accept_invite(text)                                from anon;
revoke execute on function public.add_team_to_project(uuid, uuid, text)              from anon;
revoke execute on function public.add_user_to_project_from_team(uuid, uuid, text)    from anon;
revoke execute on function public.create_invite(uuid, text, text)                    from anon;
revoke execute on function public.create_team(text, text)                            from anon;
revoke execute on function public.join_team_by_code(text)                            from anon;
revoke execute on function public.my_teams_list()                                    from anon;
revoke execute on function public.promote_client_to_team(uuid, uuid)                 from anon;
revoke execute on function public.regenerate_team_invite_code(uuid)                  from anon;
revoke execute on function public.restore_work_item(uuid)                            from anon;
revoke execute on function public.set_project_client(uuid, uuid)                     from anon;
revoke execute on function public.soft_delete_work_item(uuid)                        from anon;
revoke execute on function public.team_members_list(uuid)                            from anon;

-- Functions that still carried a PUBLIC grant: strip PUBLIC + anon, re-grant authenticated.
revoke execute on function public.can_see_client(uuid)       from public, anon;
revoke execute on function public.is_member(uuid, text)      from public, anon;
revoke execute on function public.is_team_member(uuid, text) from public, anon;
revoke execute on function public.my_visible_clients()       from public, anon;
revoke execute on function public.reschedule_project(uuid)   from public, anon;

grant execute on function public.can_see_client(uuid)        to authenticated;
grant execute on function public.is_member(uuid, text)       to authenticated;
grant execute on function public.is_team_member(uuid, text)  to authenticated;
grant execute on function public.my_visible_clients()        to authenticated;
grant execute on function public.reschedule_project(uuid)    to authenticated;
