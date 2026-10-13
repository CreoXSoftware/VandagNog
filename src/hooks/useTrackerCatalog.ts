import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentOrg } from '@/lib/currentOrg';

export interface TrackerCatalogProject {
  id: string;
  org_id: string;
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
  org_id: string;
  name: string;
}

export interface TrackerCatalog {
  projects: TrackerCatalogProject[];
  workItems: TrackerCatalogWorkItem[];
  clients: TrackerCatalogClient[];
}

export const trackerCatalogKey = ['tracker', 'catalog'] as const;

// Every project I can see in any organization, so a session or a running timer
// always has a label. Lists and pickers use useOrgTrackerCatalog instead.
export function useTrackerCatalog() {
  return useQuery({
    queryKey: trackerCatalogKey,
    queryFn: async (): Promise<TrackerCatalog> => {
      // All RLS-gated reads. Run in parallel.
      const [pRes, cRes, wRes, pcRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id,org_id,name,client_id')
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('clients')
          .select('id,org_id,name')
          .is('deleted_at', null),
        supabase
          .from('work_items')
          .select('id,project_id,parent_id,level,name,position')
          .is('deleted_at', null),
        // Client names as the Projects page shows them.
        supabase.from('project_client_view').select('project_id,client_name'),
      ]);
      if (pRes.error) throw pRes.error;
      if (cRes.error) throw cRes.error;
      if (wRes.error) throw wRes.error;
      if (pcRes.error) throw pcRes.error;

      const clientById = new Map<string, string>();
      for (const c of cRes.data ?? []) clientById.set(c.id, c.name);
      const clientNameByProject = new Map<string, string>();
      for (const r of pcRes.data ?? []) {
        if (r.project_id && r.client_name) clientNameByProject.set(r.project_id, r.client_name);
      }

      const projects: TrackerCatalogProject[] = (pRes.data ?? []).map((p) => ({
        id: p.id,
        org_id: p.org_id,
        name: p.name,
        client_id: p.client_id,
        client_name: p.client_id
          ? (clientNameByProject.get(p.id) ?? clientById.get(p.client_id) ?? null)
          : null,
      }));

      return {
        projects,
        clients: (cRes.data ?? []).map((c) => ({ id: c.id, org_id: c.org_id, name: c.name })),
        workItems: (wRes.data ?? []) as TrackerCatalogWorkItem[],
      };
    },
  });
}

// The catalog of the current organization only: what the pickers offer.
export function useOrgTrackerCatalog() {
  const { org } = useCurrentOrg();
  const q = useTrackerCatalog();
  const data = useMemo(() => (q.data ? orgSlice(q.data, org.id) : undefined), [q.data, org.id]);
  return { ...q, data };
}

export function orgSlice(catalog: TrackerCatalog, orgId: string): TrackerCatalog {
  const projects = catalog.projects.filter((p) => p.org_id === orgId);
  const ids = new Set(projects.map((p) => p.id));
  return {
    projects,
    workItems: catalog.workItems.filter((w) => ids.has(w.project_id)),
    clients: catalog.clients.filter((c) => c.org_id === orgId),
  };
}

// Whether a time entry belongs in the current organization's lists. Entries on
// a project I can no longer see can't be placed, so they show everywhere
// rather than nowhere.
export function entryInOrg(projectId: string, catalog: TrackerCatalog, orgId: string): boolean {
  const p = catalog.projects.find((x) => x.id === projectId);
  return !p || p.org_id === orgId;
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
