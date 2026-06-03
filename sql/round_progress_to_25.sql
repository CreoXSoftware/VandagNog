-- =====================================================================
-- Round all existing work_items.progress values to the nearest multiple
-- of 25 (0, 25, 50, 75, 100) to match the new discrete progress slider.
--
-- Note: rollup parents have their progress recomputed from children, so
-- their stored value may drift away from a 25-multiple after this runs.
-- That's expected — only leaf items honour the discrete set; parents
-- remain free to hold any weighted-average integer 0..100.
-- =====================================================================

update public.work_items
   set progress = least(100, greatest(0, (round(progress::numeric / 25) * 25)::int))
 where progress is not null
   and progress <> least(100, greatest(0, (round(progress::numeric / 25) * 25)::int));
