-- =====================================================================
-- DRY RUN for parent_planned_range.sql — changes NOTHING.
-- Runs the migration, then exercises the committed-range rollup, capture,
-- shrink-back, fit-to-sub-tasks, delete/restore and the dependency shift
-- on throwaway rows, then raises an exception so everything rolls back.
-- The result is the error text "DRYRUN {...}"; expected values are at the
-- bottom. Dates are in Feb/Mar 2030 (Mon 4 Feb .. Fri 8 Mar).
-- Generated from parent_planned_range.sql; re-generate if that file changes.
-- =====================================================================
-- =====================================================================
-- Committed date range on parent work items.
--
-- A parent's start_date / end_date used to be pure min/max of its children,
-- so adding a narrow sub-task shrank a parent whose dates mattered. Parents
-- can now carry a committed range in planned_start / planned_end:
--
--   start_date = least(planned_start, min(child.start_date))
--   end_date   = greatest(planned_end, max(child.end_date))
--
-- least/greatest ignore NULLs, so a parent without a committed range ("fit to
-- sub-tasks") rolls up exactly as before. start_date / end_date stay the
-- effective dates that dependencies, workload and the gantt read.
--
-- 1. Columns + snapping (planned_start snaps forward, planned_end backward).
-- 2. Rollup: rollup_parent_once / recompute_ancestors_from replace the body of
--    recompute_parent.
--    - A live parent that loses its last child turns back into a leaf on its
--      committed range.
--    - A parent deleted with its subtree keeps its range, so a restore brings
--      it back.
-- 3. Trigger:
--    - When a dated item gets its first live child (insert, reparent or
--      restore), its dates become the committed range.
--    - Changing planned_* re-envelopes the item.
--    - Reparenting now also recomputes the OLD parent, and a hard delete
--      recomputes the parent it left. Both were previously missed.
-- 4. reschedule_from / reschedule_project: rollups use the envelope. When a
--    parent's committed edge is what violates a dependency, the committed
--    window shifts (span kept) instead of a leaf.
-- 5. set_planned_range(id, start, end) RPC. NULL/NULL = fit to sub-tasks.
--
-- Function bodies are based on the live definitions (2026-10-19), not the
-- stale copies elsewhere in sql/. Run once in the Supabase SQL editor.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Columns + snapping
-- ---------------------------------------------------------------------
alter table public.work_items
  add column planned_start date,
  add column planned_end date,
  add constraint work_items_planned_range_chk check (
    (planned_start is null) = (planned_end is null)
    and (planned_start is null or planned_end >= planned_start)
  );

create or replace function public.work_items_snap_dates()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare wd int[]; nwd date[];
begin
  if new.start_date is null and new.end_date is null
     and new.planned_start is null and new.planned_end is null then
    return new;
  end if;
  select public.working_days(new.project_id), public.non_working_dates(new.project_id)
    into wd, nwd;
  if new.start_date is not null then
    new.start_date := public.snap_date_forward(new.start_date, wd, nwd);
  end if;
  if new.end_date is not null then
    new.end_date := public.snap_date_backward(new.end_date, wd, nwd);
  end if;
  if new.start_date is not null and new.end_date is not null and new.end_date < new.start_date then
    new.end_date := new.start_date;
  end if;
  if new.planned_start is not null then
    new.planned_start := public.snap_date_forward(new.planned_start, wd, nwd);
  end if;
  if new.planned_end is not null then
    new.planned_end := public.snap_date_backward(new.planned_end, wd, nwd);
  end if;
  if new.planned_start is not null and new.planned_end is not null and new.planned_end < new.planned_start then
    new.planned_end := new.planned_start;
  end if;
  return new;
end $function$;

drop trigger work_items_snap_dates_trg on public.work_items;
create trigger work_items_snap_dates_trg
  before insert or update of start_date, end_date, planned_start, planned_end on public.work_items
  for each row execute function public.work_items_snap_dates();

-- ---------------------------------------------------------------------
-- 2. Rollup
-- ---------------------------------------------------------------------
-- Recompute ONE parent from its live children and its committed range.
create or replace function public.rollup_parent_once(p_parent uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  n_kids int;
  new_start date;
  new_end date;
  new_progress int;
  p_ps date;
  p_pe date;
  p_deleted timestamptz;
begin
  select planned_start, planned_end, deleted_at into p_ps, p_pe, p_deleted
    from public.work_items where id = p_parent;
  if not found then return; end if;

  select
    count(*),
    min(start_date),
    max(end_date),
    coalesce(
      round(
        sum(
          greatest(coalesce((end_date - start_date),0) + 1, 0)::numeric * progress
        ) / nullif(sum(greatest(coalesce((end_date - start_date),0) + 1, 0)::numeric), 0),
        0
      )::int,
      0
    )
  into n_kids, new_start, new_end, new_progress
  from public.work_items
  where parent_id = p_parent and deleted_at is null;

  if n_kids = 0 and p_ps is not null then
    -- Deleted along with its subtree: keep the range so a restore brings it back.
    if p_deleted is not null then return; end if;
    -- Last child gone: back to a leaf on the committed range.
    update public.work_items
       set start_date = p_ps, end_date = p_pe,
           planned_start = null, planned_end = null,
           progress = 0
     where id = p_parent;
    return;
  end if;

  if n_kids > 0 then
    new_start := least(new_start, p_ps);
    new_end   := greatest(new_end, p_pe);
  end if;

  update public.work_items
     set start_date = new_start,
         end_date   = new_end,
         progress   = coalesce(new_progress, 0)
   where id = p_parent
     and ( start_date is distinct from new_start
        or end_date is distinct from new_end
        or progress is distinct from coalesce(new_progress, 0));
end $function$;

-- Recompute p_parent and every ancestor above it.
create or replace function public.recompute_ancestors_from(p_parent uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  cur uuid := p_parent;
  hops int := 0;
begin
  while cur is not null loop
    hops := hops + 1;
    if hops > 1000 then raise exception 'parent chain too deep for %', p_parent; end if;
    perform public.rollup_parent_once(cur);
    select parent_id into cur from public.work_items where id = cur;
  end loop;
end $function$;

-- Kept for existing callers: recompute every ancestor of p_id.
create or replace function public.recompute_parent(p_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  parent uuid;
begin
  select parent_id into parent from public.work_items where id = p_id;
  perform public.recompute_ancestors_from(parent);
end $function$;

-- ---------------------------------------------------------------------
-- 3. Trigger
-- ---------------------------------------------------------------------
create or replace function public.work_items_rollup_trg()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  became_child boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.parent_id is not null then perform public.recompute_ancestors_from(old.parent_id); end if;
    return old;
  end if;

  if new.parent_id is not null and new.deleted_at is null then
    if tg_op = 'INSERT' then
      became_child := true;
    elsif new.parent_id is distinct from old.parent_id or old.deleted_at is not null then
      became_child := true;
    end if;
  end if;

  -- First live child of a dated item: its dates become the committed range.
  if became_child then
    update public.work_items p
       set planned_start = p.start_date, planned_end = p.end_date
     where p.id = new.parent_id
       and p.planned_start is null
       and p.start_date is not null and p.end_date is not null
       and not exists (
         select 1 from public.work_items s
          where s.parent_id = p.id and s.deleted_at is null and s.id <> new.id
       );
  end if;

  if tg_op = 'UPDATE' then
    if old.parent_id is not null and new.parent_id is distinct from old.parent_id then
      perform public.recompute_ancestors_from(old.parent_id);
    end if;
    if (new.planned_start is distinct from old.planned_start
        or new.planned_end is distinct from old.planned_end)
       and exists (select 1 from public.work_items c where c.parent_id = new.id and c.deleted_at is null) then
      perform public.rollup_parent_once(new.id);
    end if;
  end if;

  if new.parent_id is not null then
    perform public.recompute_ancestors_from(new.parent_id);
  end if;
  return new;
end $function$;

drop trigger work_items_rollup on public.work_items;
create trigger work_items_rollup
  after insert or delete or update of start_date, end_date, progress, parent_id, deleted_at, planned_start, planned_end
  on public.work_items
  for each row execute function public.work_items_rollup_trg();

-- ---------------------------------------------------------------------
-- 4. Scheduling
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_from(p_work_item_id uuid, p_new_start date, p_new_end date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  wd int[]; nwd date[]; proj uuid;
  passes int := 0;
  cur_id uuid;
  d record; d2 record;
  s_id uuid;
  tgt uuid; desc_id uuid;
  tgt_start date; tgt_end date; tgt_dur int; dur int;
  pred_start date; pred_end date;
  start_b date; end_b date; cand date;
  s_start date; s_end date;
  side_start boolean;
  start_viol boolean; end_viol boolean;
  new_t_start date; new_t_end date;
  conv_pass int;
  p_id uuid;
  roll_start date; roll_end date;
  par_start date; par_end date;
  par_ps date; par_pe date;
  t_ps date; t_pe date; kid_edge date;
  tgt_planned boolean;
  rollup_passes int;
begin
  select wi.project_id, public.working_days(wi.project_id), public.non_working_dates(wi.project_id)
    into proj, wd, nwd
  from public.work_items wi where wi.id = p_work_item_id;
  if proj is null then raise exception 'work item % not found', p_work_item_id; end if;

  create temp table _eff on commit drop as
    select id, parent_id, start_date, end_date, duration_days, deleted_at, planned_start, planned_end
      from public.work_items where project_id = proj;
  create temp table _q (id uuid) on commit drop;

  -- Pre-rollup every parent bottom-up so (a) parent-as-predecessor reads have
  -- valid dates from pass one, and (b) gating-child descent through nested
  -- summaries can rank children at every level. Parents envelope their
  -- committed range.
  rollup_passes := 0;
  loop
    rollup_passes := rollup_passes + 1;
    if rollup_passes > 1000 then raise exception 'pre-rollup did not converge'; end if;
    with parents as (
      select e.id,
             least(min(c.start_date), e.planned_start) as s,
             greatest(max(c.end_date), e.planned_end) as ee
        from _eff e
        join _eff c on c.parent_id = e.id and c.deleted_at is null
       group by e.id, e.planned_start, e.planned_end
    )
    update _eff e set start_date = p.s, end_date = p.ee
      from parents p
     where e.id = p.id
       and (e.start_date is distinct from p.s or e.end_date is distinct from p.ee);
    exit when not found;
  end loop;

  update _eff set start_date = p_new_start, end_date = p_new_end, duration_days = null
   where id = p_work_item_id;
  insert into _q values (p_work_item_id);

  p_id := p_work_item_id;
  loop
    select parent_id into p_id from _eff where id = p_id;
    exit when p_id is null;
    select min(start_date), max(end_date) into roll_start, roll_end
      from _eff where parent_id = p_id and deleted_at is null;
    select start_date, end_date, planned_start, planned_end
      into par_start, par_end, par_ps, par_pe from _eff where id = p_id;
    roll_start := least(roll_start, par_ps);
    roll_end   := greatest(roll_end, par_pe);
    if roll_start is distinct from par_start or roll_end is distinct from par_end then
      update _eff set start_date = roll_start, end_date = roll_end where id = p_id;
      insert into _q select p_id where not exists (select 1 from _q where id = p_id);
    end if;
  end loop;

  loop
    delete from _q where ctid = (select ctid from _q limit 1) returning id into cur_id;
    exit when cur_id is null;
    passes := passes + 1;
    if passes > 200000 then raise exception 'reschedule did not converge'; end if;

    for d in select * from public.dependencies where predecessor_id = cur_id loop
      s_id := d.successor_id;
      perform 1 from _eff where id = s_id;
      if not found then continue; end if;

      conv_pass := 0;
      <<conv>>
      loop
        conv_pass := conv_pass + 1;
        if conv_pass > 1000 then raise exception 'succ convergence did not converge for %', s_id; end if;

        -- Compute startBinding (max over FS/SS) and endBinding (max over FF/SF)
        -- across ALL of s_id's incoming deps.
        start_b := null; end_b := null;
        for d2 in select * from public.dependencies where successor_id = s_id loop
          select start_date, end_date into pred_start, pred_end from _eff where id = d2.predecessor_id;
          if pred_start is null or pred_end is null then continue; end if;
          if d2.type = 'FS' then
            cand := public.add_working_days(pred_end, d2.lag_days + 1, wd, nwd);
            if start_b is null or cand > start_b then start_b := cand; end if;
          elsif d2.type = 'SS' then
            cand := public.add_working_days(pred_start, d2.lag_days, wd, nwd);
            if start_b is null or cand > start_b then start_b := cand; end if;
          elsif d2.type = 'FF' then
            cand := public.add_working_days(pred_end, d2.lag_days, wd, nwd);
            if end_b is null or cand > end_b then end_b := cand; end if;
          elsif d2.type = 'SF' then
            cand := public.add_working_days(pred_start, d2.lag_days, wd, nwd);
            if end_b is null or cand > end_b then end_b := cand; end if;
          end if;
        end loop;

        select start_date, end_date into s_start, s_end from _eff where id = s_id;
        if s_start is null and s_end is null then exit conv; end if;

        start_viol := (start_b is not null) and (s_start is null or start_b > s_start);
        end_viol   := (end_b   is not null) and (s_end   is null or end_b   > s_end);
        exit conv when not start_viol and not end_viol;

        -- Dominant side = larger calendar-day violation.
        if start_viol and (not end_viol
              or (start_b - coalesce(s_start, start_b)) >= (end_b - coalesce(s_end, end_b))) then
          side_start := true;
        else
          side_start := false;
        end if;

        -- Descend to the gating target for the dominant side: a leaf, or a
        -- parent whose committed edge is (or ties) the rolled edge.
        tgt := s_id;
        tgt_planned := false;
        loop
          perform 1 from _eff where parent_id = tgt and deleted_at is null;
          if not found then exit; end if;
          select planned_start, planned_end into t_ps, t_pe from _eff where id = tgt;
          if side_start then
            select min(start_date) into kid_edge from _eff where parent_id = tgt and deleted_at is null;
            if t_ps is not null and (kid_edge is null or t_ps <= kid_edge) then
              tgt_planned := true; exit;
            end if;
            select id into desc_id from _eff
              where parent_id = tgt and deleted_at is null and start_date is not null
              order by start_date asc, id asc limit 1;
          else
            select max(end_date) into kid_edge from _eff where parent_id = tgt and deleted_at is null;
            if t_pe is not null and (kid_edge is null or t_pe >= kid_edge) then
              tgt_planned := true; exit;
            end if;
            select id into desc_id from _eff
              where parent_id = tgt and deleted_at is null and end_date is not null
              order by end_date desc, id asc limit 1;
          end if;
          exit when desc_id is null;
          tgt := desc_id;
        end loop;
        if tgt is null then exit conv; end if;

        if tgt_planned then
          -- Shift the committed window, keeping its working-day span.
          dur := greatest(public.count_working_days(t_ps, t_pe, wd, nwd) - 1, 0);
          if side_start then
            new_t_start := start_b;
            new_t_end   := public.add_working_days(start_b, dur, wd, nwd);
          else
            new_t_end   := end_b;
            new_t_start := public.add_working_days(end_b, -dur, wd, nwd);
          end if;
          if t_ps is not distinct from new_t_start and t_pe is not distinct from new_t_end then
            exit conv;
          end if;
          update _eff set planned_start = new_t_start, planned_end = new_t_end where id = tgt;
          select least(min(start_date), new_t_start), greatest(max(end_date), new_t_end)
            into roll_start, roll_end
            from _eff where parent_id = tgt and deleted_at is null;
          update _eff set start_date = roll_start, end_date = roll_end where id = tgt;
          insert into _q select tgt where not exists (select 1 from _q where id = tgt);
        else
          select start_date, end_date, duration_days into tgt_start, tgt_end, tgt_dur from _eff where id = tgt;
          if tgt_start is not null and tgt_end is not null then
            dur := greatest(public.count_working_days(tgt_start, tgt_end, wd, nwd) - 1, 0);
          elsif tgt_dur is not null then
            dur := greatest(tgt_dur - 1, 0);
          else
            dur := 0;
          end if;

          if side_start then
            new_t_start := start_b;
            new_t_end   := public.add_working_days(start_b, dur, wd, nwd);
          else
            new_t_end   := end_b;
            new_t_start := public.add_working_days(end_b, -dur, wd, nwd);
          end if;

          -- No-op guard: same dates means we'd loop forever.
          if tgt_start is not distinct from new_t_start and tgt_end is not distinct from new_t_end then
            exit conv;
          end if;

          update _eff set start_date = new_t_start, end_date = new_t_end, duration_days = null
           where id = tgt;
          insert into _q select tgt where not exists (select 1 from _q where id = tgt);
        end if;

        p_id := tgt;
        loop
          select parent_id into p_id from _eff where id = p_id;
          exit when p_id is null;
          select min(start_date), max(end_date) into roll_start, roll_end
            from _eff where parent_id = p_id and deleted_at is null;
          select start_date, end_date, planned_start, planned_end
            into par_start, par_end, par_ps, par_pe from _eff where id = p_id;
          roll_start := least(roll_start, par_ps);
          roll_end   := greatest(roll_end, par_pe);
          if roll_start is distinct from par_start or roll_end is distinct from par_end then
            update _eff set start_date = roll_start, end_date = roll_end where id = p_id;
            insert into _q select p_id where not exists (select 1 from _q where id = p_id);
          end if;
        end loop;
        -- Loop body: a summary may still have violators (sibling leaf below binding);
        -- next pass recomputes binding against the updated _eff and picks the new
        -- gating target.
      end loop conv;
    end loop;
  end loop;

  update public.work_items w
     set start_date = e.start_date,
         end_date = e.end_date,
         duration_days = e.duration_days,
         planned_start = e.planned_start,
         planned_end = e.planned_end
    from _eff e
   where e.id = w.id
     and (w.start_date is distinct from e.start_date
          or w.end_date is distinct from e.end_date
          or w.duration_days is distinct from e.duration_days
          or w.planned_start is distinct from e.planned_start
          or w.planned_end is distinct from e.planned_end);
end $function$;

CREATE OR REPLACE FUNCTION public.reschedule_project(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  wd int[]; nwd date[];
  passes int := 0;
  cur_id uuid;
  d record; d2 record;
  s_id uuid; tgt uuid; desc_id uuid;
  tgt_start date; tgt_end date; tgt_dur int; dur int;
  pred_start date; pred_end date;
  start_b date; end_b date; cand date;
  s_start date; s_end date;
  side_start boolean;
  start_viol boolean; end_viol boolean;
  new_t_start date; new_t_end date;
  conv_pass int;
  p_id uuid;
  roll_start date; roll_end date;
  par_start date; par_end date;
  par_ps date; par_pe date;
  t_ps date; t_pe date; kid_edge date;
  tgt_planned boolean;
  rollup_passes int;
begin
  if not public.is_member(p_project_id, 'editor') then
    raise exception 'Not authorized to reschedule this project';
  end if;
  select public.working_days(p_project_id), public.non_working_dates(p_project_id) into wd, nwd;

  create temp table _eff on commit drop as
    select id, parent_id, start_date, end_date, duration_days, deleted_at, planned_start, planned_end
      from public.work_items where project_id = p_project_id;
  create temp table _q (id uuid) on commit drop;

  rollup_passes := 0;
  loop
    rollup_passes := rollup_passes + 1;
    if rollup_passes > 1000 then raise exception 'pre-rollup did not converge'; end if;
    with parents as (
      select e.id,
             least(min(c.start_date), e.planned_start) as s,
             greatest(max(c.end_date), e.planned_end) as ee
        from _eff e
        join _eff c on c.parent_id = e.id and c.deleted_at is null
       group by e.id, e.planned_start, e.planned_end
    )
    update _eff e set start_date = p.s, end_date = p.ee
      from parents p
     where e.id = p.id
       and (e.start_date is distinct from p.s or e.end_date is distinct from p.ee);
    exit when not found;
  end loop;

  -- Enqueue every distinct predecessor so every dep gets processed at least once
  -- (used by bulk import where multiple unrelated chains all need a forward pass).
  insert into _q
    select distinct predecessor_id from public.dependencies
      where project_id = p_project_id
        and exists (select 1 from _eff e where e.id = predecessor_id and e.deleted_at is null);

  loop
    delete from _q where ctid = (select ctid from _q limit 1) returning id into cur_id;
    exit when cur_id is null;
    passes := passes + 1;
    if passes > 200000 then raise exception 'reschedule_project did not converge'; end if;

    for d in select * from public.dependencies where predecessor_id = cur_id loop
      s_id := d.successor_id;
      perform 1 from _eff where id = s_id;
      if not found then continue; end if;

      conv_pass := 0;
      <<conv>>
      loop
        conv_pass := conv_pass + 1;
        if conv_pass > 1000 then raise exception 'succ convergence did not converge for %', s_id; end if;

        start_b := null; end_b := null;
        for d2 in select * from public.dependencies where successor_id = s_id loop
          select start_date, end_date into pred_start, pred_end from _eff where id = d2.predecessor_id;
          if pred_start is null or pred_end is null then continue; end if;
          if d2.type = 'FS' then
            cand := public.add_working_days(pred_end, d2.lag_days + 1, wd, nwd);
            if start_b is null or cand > start_b then start_b := cand; end if;
          elsif d2.type = 'SS' then
            cand := public.add_working_days(pred_start, d2.lag_days, wd, nwd);
            if start_b is null or cand > start_b then start_b := cand; end if;
          elsif d2.type = 'FF' then
            cand := public.add_working_days(pred_end, d2.lag_days, wd, nwd);
            if end_b is null or cand > end_b then end_b := cand; end if;
          elsif d2.type = 'SF' then
            cand := public.add_working_days(pred_start, d2.lag_days, wd, nwd);
            if end_b is null or cand > end_b then end_b := cand; end if;
          end if;
        end loop;

        select start_date, end_date into s_start, s_end from _eff where id = s_id;
        if s_start is null and s_end is null then exit conv; end if;

        start_viol := (start_b is not null) and (s_start is null or start_b > s_start);
        end_viol   := (end_b   is not null) and (s_end   is null or end_b   > s_end);
        exit conv when not start_viol and not end_viol;

        if start_viol and (not end_viol
              or (start_b - coalesce(s_start, start_b)) >= (end_b - coalesce(s_end, end_b))) then
          side_start := true;
        else
          side_start := false;
        end if;

        tgt := s_id;
        tgt_planned := false;
        loop
          perform 1 from _eff where parent_id = tgt and deleted_at is null;
          if not found then exit; end if;
          select planned_start, planned_end into t_ps, t_pe from _eff where id = tgt;
          if side_start then
            select min(start_date) into kid_edge from _eff where parent_id = tgt and deleted_at is null;
            if t_ps is not null and (kid_edge is null or t_ps <= kid_edge) then
              tgt_planned := true; exit;
            end if;
            select id into desc_id from _eff
              where parent_id = tgt and deleted_at is null and start_date is not null
              order by start_date asc, id asc limit 1;
          else
            select max(end_date) into kid_edge from _eff where parent_id = tgt and deleted_at is null;
            if t_pe is not null and (kid_edge is null or t_pe >= kid_edge) then
              tgt_planned := true; exit;
            end if;
            select id into desc_id from _eff
              where parent_id = tgt and deleted_at is null and end_date is not null
              order by end_date desc, id asc limit 1;
          end if;
          exit when desc_id is null;
          tgt := desc_id;
        end loop;
        if tgt is null then exit conv; end if;

        if tgt_planned then
          dur := greatest(public.count_working_days(t_ps, t_pe, wd, nwd) - 1, 0);
          if side_start then
            new_t_start := start_b;
            new_t_end   := public.add_working_days(start_b, dur, wd, nwd);
          else
            new_t_end   := end_b;
            new_t_start := public.add_working_days(end_b, -dur, wd, nwd);
          end if;
          if t_ps is not distinct from new_t_start and t_pe is not distinct from new_t_end then
            exit conv;
          end if;
          update _eff set planned_start = new_t_start, planned_end = new_t_end where id = tgt;
          select least(min(start_date), new_t_start), greatest(max(end_date), new_t_end)
            into roll_start, roll_end
            from _eff where parent_id = tgt and deleted_at is null;
          update _eff set start_date = roll_start, end_date = roll_end where id = tgt;
          insert into _q select tgt where not exists (select 1 from _q where id = tgt);
        else
          select start_date, end_date, duration_days into tgt_start, tgt_end, tgt_dur from _eff where id = tgt;
          if tgt_start is not null and tgt_end is not null then
            dur := greatest(public.count_working_days(tgt_start, tgt_end, wd, nwd) - 1, 0);
          elsif tgt_dur is not null then
            dur := greatest(tgt_dur - 1, 0);
          else
            dur := 0;
          end if;

          if side_start then
            new_t_start := start_b;
            new_t_end   := public.add_working_days(start_b, dur, wd, nwd);
          else
            new_t_end   := end_b;
            new_t_start := public.add_working_days(end_b, -dur, wd, nwd);
          end if;

          if tgt_start is not distinct from new_t_start and tgt_end is not distinct from new_t_end then
            exit conv;
          end if;

          update _eff set start_date = new_t_start, end_date = new_t_end, duration_days = null
           where id = tgt;
          insert into _q select tgt where not exists (select 1 from _q where id = tgt);
        end if;

        p_id := tgt;
        loop
          select parent_id into p_id from _eff where id = p_id;
          exit when p_id is null;
          select min(start_date), max(end_date) into roll_start, roll_end
            from _eff where parent_id = p_id and deleted_at is null;
          select start_date, end_date, planned_start, planned_end
            into par_start, par_end, par_ps, par_pe from _eff where id = p_id;
          roll_start := least(roll_start, par_ps);
          roll_end   := greatest(roll_end, par_pe);
          if roll_start is distinct from par_start or roll_end is distinct from par_end then
            update _eff set start_date = roll_start, end_date = roll_end where id = p_id;
            insert into _q select p_id where not exists (select 1 from _q where id = p_id);
          end if;
        end loop;
      end loop conv;
    end loop;
  end loop;

  update public.work_items w
     set start_date = e.start_date,
         end_date = e.end_date,
         duration_days = e.duration_days,
         planned_start = e.planned_start,
         planned_end = e.planned_end
    from _eff e
   where e.id = w.id
     and (w.start_date is distinct from e.start_date
          or w.end_date is distinct from e.end_date
          or w.duration_days is distinct from e.duration_days
          or w.planned_start is distinct from e.planned_start
          or w.planned_end is distinct from e.planned_end);
end $function$;

-- ---------------------------------------------------------------------
-- 5. set_planned_range
-- ---------------------------------------------------------------------
-- Commit a parent to a date range (or NULL/NULL to fit it to its sub-tasks),
-- then cascade successors off its new effective dates. Security invoker:
-- RLS decides who may update the row, exactly like reschedule_from.
create or replace function public.set_planned_range(p_work_item_id uuid, p_start date, p_end date)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_start date;
  v_end date;
begin
  if (p_start is null) <> (p_end is null) then
    raise exception 'A committed range needs both a start and an end';
  end if;
  if p_start is not null and p_end < p_start then
    raise exception 'End date is before start date';
  end if;
  if not exists (
    select 1 from public.work_items where parent_id = p_work_item_id and deleted_at is null
  ) then
    raise exception 'Only items with sub-items have a committed range';
  end if;

  update public.work_items
     set planned_start = p_start, planned_end = p_end
   where id = p_work_item_id and deleted_at is null;
  if not found then
    raise exception 'Work item not found or not editable';
  end if;

  select start_date, end_date into v_start, v_end from public.work_items where id = p_work_item_id;
  if v_start is not null and v_end is not null then
    perform public.reschedule_from(p_work_item_id, v_start, v_end);
  end if;
end $function$;

revoke execute on function public.set_planned_range(uuid, date, date) from public, anon;
grant execute on function public.set_planned_range(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------
do $test$
declare
  PJ uuid; P uuid; C1 uuid; P2 uuid; C2 uuid; X uuid; P3 uuid; C3 uuid;
  r record;
  out jsonb := '{}'::jsonb;
begin
  select id into PJ from public.projects order by created_at limit 1;

  -- 1. a dated leaf gets its first child: its dates become the committed range
  insert into public.work_items (project_id, name, start_date, end_date)
    values (PJ, 'dryrun P', '2030-02-04', '2030-02-22') returning id into P;
  insert into public.work_items (project_id, parent_id, name, start_date, end_date)
    values (PJ, P, 'dryrun C1', '2030-02-11', '2030-02-13') returning id into C1;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('1_capture', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 2. child runs past the committed end: parent expands
  update public.work_items set end_date = '2030-02-27' where id = C1;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('2_expand', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 3. child comes back inside: parent shrinks back to the committed range
  update public.work_items set end_date = '2030-02-13' where id = C1;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('3_shrink_back', format('%s..%s', r.start_date, r.end_date));

  -- 4. fit to sub-tasks: pure rollup again
  update public.work_items set planned_start = null, planned_end = null where id = P;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('4_fit', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 5. set_planned_range re-commits
  perform public.set_planned_range(P, '2030-02-04', '2030-02-22');
  drop table if exists _eff; drop table if exists _q;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('5_set_range', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 6. an FS predecessor ending Fri 15 Feb pushes the committed window to
  --    start Mon 18 Feb (span kept), then the child that still starts too
  --    early is pushed as well
  insert into public.work_items (project_id, name, start_date, end_date)
    values (PJ, 'dryrun X', '2030-02-04', '2030-02-15') returning id into X;
  insert into public.dependencies (project_id, predecessor_id, successor_id, type, lag_days)
    values (PJ, X, P, 'FS', 0);
  perform public.reschedule_from(X, '2030-02-04', '2030-02-15');
  drop table if exists _eff; drop table if exists _q;
  select * into r from public.work_items where id = P;
  out := out || jsonb_build_object('6_dep_parent', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));
  select * into r from public.work_items where id = C1;
  out := out || jsonb_build_object('6_dep_child', format('%s..%s', r.start_date, r.end_date));

  -- 7. an undated parent never captures: fit-to-sub-tasks, as before
  insert into public.work_items (project_id, name) values (PJ, 'dryrun P2') returning id into P2;
  insert into public.work_items (project_id, parent_id, name, start_date, end_date)
    values (PJ, P2, 'dryrun C2', '2030-02-04', '2030-02-06') returning id into C2;
  select * into r from public.work_items where id = P2;
  out := out || jsonb_build_object('7_undated_parent', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 8. committed range snaps to working days (Sat 9 .. Sun 17 Feb)
  perform public.set_planned_range(P2, '2030-02-09', '2030-02-17');
  drop table if exists _eff; drop table if exists _q;
  select * into r from public.work_items where id = P2;
  out := out || jsonb_build_object('8_snap', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 9. deleting the last child turns the parent back into a leaf on its range;
  --    restoring the child re-captures it
  insert into public.work_items (project_id, name, start_date, end_date)
    values (PJ, 'dryrun P3', '2030-02-04', '2030-02-22') returning id into P3;
  insert into public.work_items (project_id, parent_id, name, start_date, end_date)
    values (PJ, P3, 'dryrun C3', '2030-02-11', '2030-02-13') returning id into C3;
  update public.work_items set deleted_at = now() where id = C3;
  select * into r from public.work_items where id = P3;
  out := out || jsonb_build_object('9a_last_child_deleted', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));
  update public.work_items set deleted_at = null where id = C3;
  select * into r from public.work_items where id = P3;
  out := out || jsonb_build_object('9b_child_restored', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 10. deleting and restoring the whole subtree in one statement each
  --     (as soft_delete_work_item / restore_work_item do) keeps the range
  update public.work_items set deleted_at = now() where id in (P3, C3);
  update public.work_items set deleted_at = null where id in (P3, C3);
  select * into r from public.work_items where id = P3;
  out := out || jsonb_build_object('10_subtree_restore', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 11. moving the last child out recomputes the OLD parent
  update public.work_items set parent_id = null where id = C3;
  select * into r from public.work_items where id = P3;
  out := out || jsonb_build_object('11_reparent_out', format('%s..%s planned %s..%s', r.start_date, r.end_date, r.planned_start, r.planned_end));

  -- 12. half a range is rejected
  begin
    update public.work_items set planned_start = null where id = P;
    out := out || jsonb_build_object('12_half_range', 'allowed (bad)');
  exception when check_violation then out := out || jsonb_build_object('12_half_range', 'blocked'); end;

  -- 13. set_planned_range refuses a leaf
  begin
    perform public.set_planned_range(X, '2030-02-04', '2030-02-08');
    out := out || jsonb_build_object('13_leaf_range', 'allowed (bad)');
  exception when others then out := out || jsonb_build_object('13_leaf_range', 'blocked'); end;

  raise exception 'DRYRUN %', out;
end
$test$;

-- Expected:
--   1_capture             "2030-02-04..2030-02-22 planned 2030-02-04..2030-02-22"
--   2_expand              "2030-02-04..2030-02-27 planned 2030-02-04..2030-02-22"
--   3_shrink_back         "2030-02-04..2030-02-22"
--   4_fit                 "2030-02-11..2030-02-13 planned .."
--   5_set_range           "2030-02-04..2030-02-22 planned 2030-02-04..2030-02-22"
--   6_dep_parent          "2030-02-18..2030-03-08 planned 2030-02-18..2030-03-08"
--   6_dep_child           "2030-02-18..2030-02-20"
--   7_undated_parent      "2030-02-04..2030-02-06 planned .."
--   8_snap                "2030-02-04..2030-02-15 planned 2030-02-11..2030-02-15"
--   9a_last_child_deleted "2030-02-04..2030-02-22 planned .."
--   9b_child_restored     "2030-02-04..2030-02-22 planned 2030-02-04..2030-02-22"
--   10_subtree_restore    "2030-02-04..2030-02-22 planned 2030-02-04..2030-02-22"
--   11_reparent_out       "2030-02-04..2030-02-22 planned .."
--   12_half_range "blocked", 13_leaf_range "blocked"
