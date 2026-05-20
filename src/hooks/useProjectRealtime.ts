import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { workItemsKey } from './useWorkItems';
import { dependenciesKey } from './useDependencies';
import { membersKey } from './useMembers';
import { nonWorkingDaysKey } from './useNonWorkingDays';
import { projectKey } from './useProjects';
import { recentLocalWorkItemMutation } from '@/lib/localMutationGuard';

export function useProjectRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  const workItemsTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!projectId) return;
    function debouncedInvalidateWorkItems() {
      if (workItemsTimer.current != null) window.clearTimeout(workItemsTimer.current);
      workItemsTimer.current = window.setTimeout(() => {
        workItemsTimer.current = null;
        // Skip if we just mutated locally — optimistic cascade already reflects the change.
        if (recentLocalWorkItemMutation()) return;
        qc.invalidateQueries({ queryKey: workItemsKey(projectId!) });
      }, 150);
    }
    const channel = supabase
      .channel(`project:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_items', filter: `project_id=eq.${projectId}` },
        debouncedInvalidateWorkItems,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dependencies', filter: `project_id=eq.${projectId}` },
        () => {
          if (recentLocalWorkItemMutation()) return;
          qc.invalidateQueries({ queryKey: dependenciesKey(projectId) });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { work_item_id?: string } | undefined;
          if (row?.work_item_id) qc.invalidateQueries({ queryKey: ['comments', row.work_item_id] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: membersKey(projectId) }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: projectKey(projectId) }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'non_working_days', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: nonWorkingDaysKey(projectId) }),
      )
      .subscribe();

    return () => {
      if (workItemsTimer.current != null) {
        window.clearTimeout(workItemsTimer.current);
        workItemsTimer.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);
}
