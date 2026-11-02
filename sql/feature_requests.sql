-- =====================================================================
-- Feedback: feature requests and bug reports, sent to the app developer.
--
-- Anyone signed in sends a request (any org, any role, Personal too). It goes
-- to the app admins (the developers of the app, listed in app_admins), not to
-- the sender's organization.
--
--   submitter  : sees their own requests; cannot edit or delete them once
--                sent. Gets a notification when the status changes.
--   app admin  : sees every request, gets a notification for each new one,
--                and changes the status (new -> approved / in_progress /
--                done / rejected). Status is the only column anyone can update.
--
-- Who sent it (name, email) and from which shared org are copied onto the
-- request when it is sent: the app admin is usually not in that org and could
-- not look them up, and the copy outlives the sender leaving.
--
-- steps_to_reproduce and priority are for bugs only.
--
-- Requires organizations.sql. Run once in the Supabase SQL editor;
-- feature_requests_dryrun.sql checks it first without changing anything.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. App admins
-- ---------------------------------------------------------------------
-- The app's developers. Managed from the SQL editor only: no policies, no
-- grants, so clients can't read or change it.
create table public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from public, anon, authenticated;

create function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

insert into public.app_admins (user_id)
select id from auth.users where lower(email) = 'nelis@creox.co.za';

do $$
begin
  if not exists (select 1 from public.app_admins) then
    raise exception 'No app admin: nelis@creox.co.za has no account';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------
create table public.feature_requests (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in ('feature', 'bug')),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  description        text not null check (char_length(btrim(description)) between 1 and 10000),
  steps_to_reproduce text check (char_length(steps_to_reproduce) <= 10000),
  priority           text check (priority in ('low', 'medium', 'high', 'critical')),
  status             text not null default 'new'
                       check (status in ('new', 'approved', 'in_progress', 'done', 'rejected')),
  submitted_by       uuid default auth.uid() references auth.users(id) on delete set null,
  -- Set by feature_requests_stamp, not by the client.
  sender_name        text,
  sender_email       text,
  org_id             uuid references public.organizations(id) on delete set null,
  org_name           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint feature_requests_bug_fields
    check (type = 'bug' or (steps_to_reproduce is null and priority is null))
);

-- The app admin's list (newest first) and "my requests"; also cover the FK
-- set-nulls.
create index feature_requests_created_idx on public.feature_requests (created_at desc);
create index feature_requests_submitter_idx on public.feature_requests (submitted_by, created_at desc);
create index feature_requests_org_idx on public.feature_requests (org_id);

create trigger feature_requests_touch
  before update on public.feature_requests
  for each row execute function public.touch_updated_at();

-- Copy who sent it and the shared org picked in their top bar (none from the
-- Personal org). Definer: reads auth.users, and orgs the sender may not be
-- able to read.
create function public.feature_requests_stamp()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  select nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), o.id, o.name
    into new.sender_name, new.org_id, new.org_name
    from (select auth.uid() as uid) me
    left join public.user_settings s on s.user_id = me.uid
    left join public.org_members m on m.org_id = s.current_org_id and m.user_id = me.uid
    left join public.organizations o on o.id = m.org_id and not o.is_personal;
  select email into new.sender_email from auth.users where id = auth.uid();
  return new;
end
$$;

create trigger feature_requests_stamp
  before insert on public.feature_requests
  for each row execute function public.feature_requests_stamp();

-- ---------------------------------------------------------------------
-- 3. Notifications
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
  check (event_type in ('assigned', 'mentioned_in_comment', 'comment_on_assigned_item', 'invited',
                        'predecessor_moved', 'assigned_item_deleted',
                        'feedback_received', 'feedback_status'));

-- New request -> every app admin (but not the one who sent it). The sender's
-- name goes in the payload: app admins usually can't read their profile.
create function public.notify_feedback_received()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications(user_id, actor_id, event_type, entity_id, payload)
  select a.user_id, new.submitted_by, 'feedback_received', new.id,
         jsonb_strip_nulls(jsonb_build_object(
           'name', new.title, 'type', new.type, 'priority', new.priority,
           'sender', coalesce(new.sender_name, new.sender_email)))
    from public.app_admins a
   where a.user_id is distinct from new.submitted_by;
  return new;
end
$$;

create trigger feature_requests_notify_received
  after insert on public.feature_requests
  for each row execute function public.notify_feedback_received();

-- Status changed -> the sender (unless they changed it themselves).
create function public.notify_feedback_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if new.submitted_by is not null and new.submitted_by is distinct from actor then
    insert into public.notifications(user_id, actor_id, event_type, entity_id, payload)
      values (new.submitted_by, actor, 'feedback_status', new.id,
              jsonb_build_object('name', new.title, 'type', new.type, 'status', new.status));
  end if;
  return new;
end
$$;

create trigger feature_requests_notify_status
  after update of status on public.feature_requests
  for each row when (old.status is distinct from new.status)
  execute function public.notify_feedback_status();

-- ---------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------
alter table public.feature_requests enable row level security;

create policy feature_requests_select on public.feature_requests
  for select to authenticated
  using (submitted_by = (select auth.uid()) or (select public.is_app_admin()));

create policy feature_requests_insert on public.feature_requests
  for insert to authenticated
  with check (submitted_by = (select auth.uid()) and status = 'new');

-- Triage. The column grant below limits it to status.
create policy feature_requests_update on public.feature_requests
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

-- No delete policy: requests are kept; rejecting one closes it.

revoke all on public.feature_requests from public, anon, authenticated;
grant select on public.feature_requests to authenticated;
grant insert (type, title, description, steps_to_reproduce, priority)
  on public.feature_requests to authenticated;
grant update (status) on public.feature_requests to authenticated;

commit;
