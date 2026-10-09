-- =====================================================================
-- Time-entry import (Tracker → Import, e.g. a Clockify CSV export).
--
-- Not applied automatically — run once in the Supabase SQL editor.
--
-- 1. Import bookkeeping columns on time_entries. (import_source, import_key)
--    is unique, so re-importing an updated export can never create the same
--    entry twice — the database refuses it, whatever the client does.
-- 2. import_time_entries(): inserts a batch of rows, possibly for other
--    people. time_entries_insert only allows user_id = auth.uid(), so this is
--    SECURITY DEFINER with its own checks:
--      * the caller must be an owner/editor of each row's project;
--      * the person must be a member of that project — or, when
--        p_add_members is set, the caller must own the project and share a
--        team with the person (same rule as add_user_to_project_from_team),
--        and the person is added as an editor;
--      * a work item must belong to the same project and be live;
--      * end must be after start.
--    Rows failing a check are reported back, not raised, so one bad row does
--    not sink the batch.
-- 3. undo_time_entry_import(): deletes one import batch, only the rows the
--    caller imported.
-- =====================================================================

alter table public.time_entries
  add column if not exists import_source text,
  add column if not exists import_key    text,
  add column if not exists import_batch  uuid,
  add column if not exists imported_by   uuid references auth.users(id) on delete set null;

create unique index if not exists time_entries_import_key_uniq
  on public.time_entries (import_source, import_key)
  where import_key is not null;

create index if not exists time_entries_import_batch_idx
  on public.time_entries (import_batch)
  where import_batch is not null;

create or replace function public.import_time_entries(
  p_source      text,
  p_batch       uuid,
  p_rows        jsonb,
  p_add_members boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

      -- Effective membership (own row or a linked team); needs project_teams.sql.
      if public.project_role(v_project, v_user) is null then
        if p_add_members
           and public.is_member(v_project, 'owner')
           and exists (
             select 1 from public.team_members ta
             join public.team_members tb on tb.team_id = ta.team_id
             where ta.user_id = v_uid and tb.user_id = v_user
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

create or replace function public.undo_time_entry_import(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.time_entries
   where import_batch = p_batch
     and imported_by = auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke execute on function public.import_time_entries(text, uuid, jsonb, boolean) from public, anon;
grant  execute on function public.import_time_entries(text, uuid, jsonb, boolean) to authenticated;
revoke execute on function public.undo_time_entry_import(uuid) from public, anon;
grant  execute on function public.undo_time_entry_import(uuid) to authenticated;
