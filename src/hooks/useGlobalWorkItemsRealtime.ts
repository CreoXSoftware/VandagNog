import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { recentLocalWorkItemMutation } from '@/lib/localMutationGuard';
import { tasksDataKey } from './useTasksData';

// Keeps the global Tasks page fresh. useProjectRealtime filters every listener
// by `project_id=eq.<one id>`, so it delivers nothing to a cross-project view;
// this subscribes unfiltered and lets RLS decide which rows reach us.
//
// Volume is much higher than the per-project channel (every work-item change in
// every project you belong to), so the 150 ms debounce matters more here.
export function useGlobalWorkItemsRealtime(enabled = true) {
  const qc = useQueryClient();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function debouncedInvalidate() {
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        // Skip if we just mutated locally — the optimistic patch already
        // reflects the change and refetching would fight it.
        if (recentLocalWorkItemMutation()) return;
        qc.invalidateQueries({ queryKey: tasksDataKey });
      }, 150);
    }

    // Unique channel name per subscriber — re-using one name across mounted
    // hooks triggers "cannot add postgres_changes callbacks after subscribe()".
    const name = `tasks_global:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, debouncedInvalidate)
      .subscribe();

    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [qc, enabled]);
}
