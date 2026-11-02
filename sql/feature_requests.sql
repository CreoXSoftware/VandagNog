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

begin;

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

commit;
