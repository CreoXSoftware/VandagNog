-- =====================================================================
-- Work-item attachments
-- Run in Supabase SQL editor. Idempotent.
-- Requires: public.work_items, public.projects, public.is_member(uuid, text).
-- =====================================================================

-- 1. Storage bucket --------------------------------------------------
-- Private bucket, 25 MB cap, no MIME restriction.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-item-attachments', 'work-item-attachments', false, 26214400, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Table -----------------------------------------------------------
create table if not exists public.work_item_attachments (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 300),
  file_size    bigint not null check (file_size > 0 and file_size <= 26214400),
  mime_type    text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists wia_work_item_idx on public.work_item_attachments(work_item_id);
create index if not exists wia_project_idx   on public.work_item_attachments(project_id);

-- 3. RLS — table ----------------------------------------------------
alter table public.work_item_attachments enable row level security;

drop policy if exists wia_select on public.work_item_attachments;
create policy wia_select on public.work_item_attachments for select
  using (public.is_member(project_id, 'member'));

drop policy if exists wia_insert on public.work_item_attachments;
create policy wia_insert on public.work_item_attachments for insert
  with check (
    public.is_member(project_id, 'member')
    and uploaded_by = auth.uid()
  );

drop policy if exists wia_delete on public.work_item_attachments;
create policy wia_delete on public.work_item_attachments for delete
  using (
    uploaded_by = auth.uid()
    or public.is_member(project_id, 'owner')
  );

-- No update policy — attachments are immutable.

-- 4. RLS — storage.objects (bucket-scoped) ---------------------------
-- Path layout: {project_id}/{work_item_id}/{attachment_id}-{file_name}
-- foldername()[1] is the project_id segment.

drop policy if exists wia_storage_select on storage.objects;
create policy wia_storage_select on storage.objects for select
  using (
    bucket_id = 'work-item-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );

drop policy if exists wia_storage_insert on storage.objects;
create policy wia_storage_insert on storage.objects for insert
  with check (
    bucket_id = 'work-item-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );

drop policy if exists wia_storage_delete on storage.objects;
create policy wia_storage_delete on storage.objects for delete
  using (
    bucket_id = 'work-item-attachments'
    and public.is_member(((storage.foldername(name))[1])::uuid, 'member')
  );
