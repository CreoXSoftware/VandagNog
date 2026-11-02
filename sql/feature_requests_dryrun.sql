-- =====================================================================
-- DRY RUN for feature_requests.sql — changes NOTHING.
-- Runs the migration, then exercises sending and triaging feedback as real
-- users under RLS, then raises an exception so everything rolls back. The
-- result is the error text "DRYRUN {...}"; expected values are at the bottom.
-- Generated from feature_requests.sql; re-generate if that file changes.
-- =====================================================================
-- =====================================================================
-- Feedback: feature requests and bug reports.
--
-- Anyone signed in sends a request to one of their shared organizations
-- (any role, guests too). Personal orgs can't receive feedback: their only
-- owner is the sender, so nobody would ever triage it.
--
--   submitter        : sees their own requests (also after leaving the org);
--                      cannot edit or delete them once sent.
--   org owner/admin  : sees every request sent to the org and changes its
--                      status (new -> approved / in_progress / done / rejected).
--                      Status is the only column anyone can update.
--
-- steps_to_reproduce and priority are for bugs only.
--
-- Requires organizations.sql (is_org_member). Run once in the Supabase SQL
-- editor; feature_requests_dryrun.sql checks it first without changing anything.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table public.feature_requests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  type               text not null check (type in ('feature', 'bug')),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  description        text not null check (char_length(btrim(description)) between 1 and 10000),
  steps_to_reproduce text check (char_length(steps_to_reproduce) <= 10000),
  priority           text check (priority in ('low', 'medium', 'high', 'critical')),
  status             text not null default 'new'
                       check (status in ('new', 'approved', 'in_progress', 'done', 'rejected')),
  submitted_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint feature_requests_bug_fields
    check (type = 'bug' or (steps_to_reproduce is null and priority is null))
);

-- The org's list (newest first) and "my requests"; also cover the FK cascades.
create index feature_requests_org_idx on public.feature_requests (org_id, created_at desc);
create index feature_requests_submitter_idx on public.feature_requests (submitted_by, created_at desc);

create trigger feature_requests_touch
  before update on public.feature_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Who may send to an org
-- ---------------------------------------------------------------------
-- Am I in p_org (any role) and is it a shared org? Definer because members
-- and guests can't read organizations rows themselves.
create function public.can_send_feedback(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.organizations o
      join public.org_members m on m.org_id = o.id and m.user_id = auth.uid()
     where o.id = p_org and not o.is_personal
  );
$$;
revoke all on function public.can_send_feedback(uuid) from public, anon;
grant execute on function public.can_send_feedback(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.feature_requests enable row level security;

create policy feature_requests_select on public.feature_requests
  for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_org_member(org_id, 'admin'));

create policy feature_requests_insert on public.feature_requests
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and status = 'new'
    and public.can_send_feedback(org_id)
  );

-- Triage. The column grant below limits it to status.
create policy feature_requests_update on public.feature_requests
  for update to authenticated
  using (public.is_org_member(org_id, 'admin'))
  with check (public.is_org_member(org_id, 'admin'));

-- No delete policy: requests are kept; rejecting one closes it.

revoke all on public.feature_requests from public, anon, authenticated;
grant select on public.feature_requests to authenticated;
grant insert (org_id, type, title, description, steps_to_reproduce, priority)
  on public.feature_requests to authenticated;
grant update (status) on public.feature_requests to authenticated;


do $test$
declare
  O  uuid;  -- a shared org
  A  uuid;  -- its owner/admin
  M  uuid;  -- someone else in it (member or guest)
  X  uuid;  -- someone not in it
  PM uuid;  -- M's personal org
  R  uuid;
  out jsonb := '{}'::jsonb;
  n int; r text;
begin
  -- the shared org with the most people, so there is an admin and a non-admin
  select o.id into O
    from organizations o join org_members m on m.org_id = o.id
   where not o.is_personal
   group by o.id
  having bool_or(m.role in ('owner', 'admin')) and bool_or(m.role in ('member', 'guest'))
   order by count(*) desc limit 1;
  select user_id into A from org_members where org_id = O and role in ('owner', 'admin') limit 1;
  select user_id into M from org_members where org_id = O and role in ('member', 'guest') limit 1;
  select u.id into X from auth.users u
   where not exists (select 1 from org_members m where m.org_id = O and m.user_id = u.id) limit 1;
  select id into PM from organizations where is_personal and created_by = M;

  -- 1. M sends a bug; it starts as "new" and is stamped as theirs
  perform set_config('request.jwt.claims', json_build_object('sub', M, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into feature_requests (org_id, type, title, description, steps_to_reproduce, priority)
  values (O, 'bug', 'Dry run bug', 'Something broke', '1. click 2. boom', 'high')
  returning id into R;
  select status || '/' || case when submitted_by = M then 'mine' else 'other (bad)' end
    into r from feature_requests where id = R;
  out := out || jsonb_build_object('1_sent', r);

  -- 2. cannot send it pre-approved
  begin
    insert into feature_requests (org_id, type, title, description, status)
    values (O, 'feature', 'x', 'x', 'done');
    out := out || jsonb_build_object('2_forge_status', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('2_forge_status', 'blocked'); end;

  -- 3. cannot send it in someone else's name
  begin
    insert into feature_requests (org_id, type, title, description, submitted_by)
    values (O, 'feature', 'x', 'x', A);
    out := out || jsonb_build_object('3_forge_sender', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('3_forge_sender', 'blocked'); end;

  -- 4. not to a personal org
  begin
    insert into feature_requests (org_id, type, title, description) values (PM, 'feature', 'x', 'x');
    out := out || jsonb_build_object('4_personal_org', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('4_personal_org', 'blocked'); end;

  -- 5. priority / steps only on bugs
  begin
    insert into feature_requests (org_id, type, title, description, priority) values (O, 'feature', 'x', 'x', 'high');
    out := out || jsonb_build_object('5_feature_priority', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('5_feature_priority', 'blocked'); end;

  -- 6. the sender cannot change the status (RLS hides the row from the update)
  update feature_requests set status = 'done' where id = R;
  select status into r from feature_requests where id = R;
  out := out || jsonb_build_object('6_sender_status', r);
  reset role;

  -- 7. the admin sees it and approves it
  perform set_config('request.jwt.claims', json_build_object('sub', A, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from feature_requests where id = R;
  out := out || jsonb_build_object('7_admin_sees', n);
  update feature_requests set status = 'approved' where id = R;
  select status into r from feature_requests where id = R;
  out := out || jsonb_build_object('7_admin_status', r);

  -- 8. ...but cannot rewrite what was sent
  begin
    update feature_requests set title = 'edited' where id = R;
    out := out || jsonb_build_object('8_admin_title', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('8_admin_title', 'blocked'); end;

  -- 9. ...nor set an unknown status
  begin
    update feature_requests set status = 'maybe' where id = R;
    out := out || jsonb_build_object('9_bad_status', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('9_bad_status', 'blocked'); end;
  reset role;

  -- 10. an outsider sees nothing and cannot send to the org
  perform set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from feature_requests where id = R;
  out := out || jsonb_build_object('10_outsider_sees', n);
  begin
    insert into feature_requests (org_id, type, title, description) values (O, 'feature', 'x', 'x');
    out := out || jsonb_build_object('10_outsider_send', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('10_outsider_send', 'blocked'); end;
  reset role;

  -- 11. anon has no access at all
  set local role anon;
  begin
    perform 1 from feature_requests;
    out := out || jsonb_build_object('11_anon', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('11_anon', 'blocked'); end;
  reset role;

  raise exception 'DRYRUN %', out;
end
$test$;

-- Expected:
--   1_sent "new/mine", 2_forge_status "blocked", 3_forge_sender "blocked"
--   4_personal_org "blocked", 5_feature_priority "blocked", 6_sender_status "new"
--   7_admin_sees 1, 7_admin_status "approved", 8_admin_title "blocked"
--   9_bad_status "blocked", 10_outsider_sees 0, 10_outsider_send "blocked"
--   11_anon "blocked"
