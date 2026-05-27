-- =====================================================================
-- Hard-delete dependencies when a work item is soft-deleted.
-- Applied via MCP migration soft_delete_work_item_purges_dependencies.
-- Kept here for reference / re-apply.
-- =====================================================================

create or replace function public.soft_delete_work_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project from public.work_items where id = p_id and deleted_at is null;
  if v_project is null then
    raise exception 'Work item not found or already deleted';
  end if;
  if not public.is_member(v_project, 'editor') then
    raise exception 'Not authorized to delete work items in this project';
  end if;
  update public.work_items set deleted_at = now() where id = p_id;
  delete from public.dependencies
   where project_id = v_project
     and (predecessor_id = p_id or successor_id = p_id);
end;
$function$;

-- One-shot cleanup of pre-existing orphan deps.
delete from public.dependencies d
where exists (
  select 1 from public.work_items w
  where w.id in (d.predecessor_id, d.successor_id) and w.deleted_at is not null
);
