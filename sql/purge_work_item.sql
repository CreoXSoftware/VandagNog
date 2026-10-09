-- =====================================================================
-- Permanently delete a soft-deleted work item ("Delete permanently" in the
-- Tasks page's Recently deleted view).
--
-- The client cannot do this itself: wi_select hides deleted rows, and Postgres
-- applies SELECT policies to a DELETE's WHERE clause, so a plain
-- `delete from work_items where id = ...` matches nothing.
--
-- parent_id is `on delete cascade`, so the item's (already deleted) sub-items
-- go with it. A live descendant would be taken down too, so that is refused.
-- log_changes() records each removed row as 'delete' with after = null, which
-- is how the bin knows the item is gone for good.
--
-- Not applied automatically — run once in the Supabase SQL editor.
-- =====================================================================

create or replace function public.purge_work_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project
    from public.work_items
   where id = p_id and deleted_at is not null;
  if v_project is null then
    raise exception 'Work item not found or not deleted';
  end if;
  if not public.is_member(v_project, 'editor') then
    raise exception 'Not authorized to delete work items in this project';
  end if;

  if exists (
    with recursive sub(id) as (
      select w.id from public.work_items w where w.parent_id = p_id
      union all
      select w.id from public.work_items w join sub on w.parent_id = sub.id
    )
    select 1 from public.work_items w join sub on sub.id = w.id
     where w.deleted_at is null
  ) then
    raise exception 'This item still has live sub-items. Restore or move them first.';
  end if;

  delete from public.work_items where id = p_id;
end;
$function$;

revoke execute on function public.purge_work_item(uuid) from public, anon;
grant execute on function public.purge_work_item(uuid) to authenticated;
