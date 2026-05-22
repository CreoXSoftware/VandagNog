import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface TrackerCatalogProject {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
}

export interface TrackerCatalogWorkItem {
  id: string;
  project_id: string;
  parent_id: string | null;
  level: number;
  name: string;
  position: number;
}

export interface TrackerCatalogClient {
  id: string;
  name: string;
}

export interface TrackerCatalog {
  projects: TrackerCatalogProject[];
  workItems: TrackerCatalogWorkItem[];
  clients: TrackerCatalogClient[];
}

export const trackerCatalogKey = ['tracker', 'catalog'] as const;

export function useTrackerCatalog() {
  return useQuery({
    queryKey: trackerCatalogKey,
    queryFn: async (): Promise<TrackerCatalog> => {
      // All RLS-gated reads. Run in parallel.
      const [pRes, cRes, wRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id,name,client_id')
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('clients')
          .select('id,name')
          .is('deleted_at', null),
        supabase
          .from('work_items')
          .select('id,project_id,parent_id,level,name,position')
          .is('deleted_at', null),
      ]);
      if (pRes.error) throw pRes.error;
      if (cRes.error) throw cRes.error;
      if (wRes.error) throw wRes.error;

      const clientById = new Map<string, string>();
      for (const c of cRes.data ?? []) clientById.set(c.id, c.name);

      const projects: TrackerCatalogProject[] = (pRes.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        client_id: p.client_id,
        client_name: p.client_id ? (clientById.get(p.client_id) ?? null) : null,
      }));

      return {
        projects,
        clients: (cRes.data ?? []).map((c) => ({ id: c.id, name: c.name })),
        workItems: (wRes.data ?? []) as TrackerCatalogWorkItem[],
      };
    },
  });
}

// Build "Client > Project > Task > Sub" path for a work item.
export function workItemPath(
  workItemId: string,
  workItems: TrackerCatalogWorkItem[],
): string[] {
  const byId = new Map(workItems.map((w) => [w.id, w]));
  const path: string[] = [];
  let cur = byId.get(workItemId);
  while (cur) {
    path.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return path;
}
