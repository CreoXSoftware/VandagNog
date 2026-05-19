import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { workItemsKey } from './useWorkItems';
import { dependenciesKey } from './useDependencies';
import { membersKey } from './useMembers';
import { projectKey } from './useProjects';

export function useProjectRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_items', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: workItemsKey(projectId) }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dependencies', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: dependenciesKey(projectId) }),
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, qc]);
}
