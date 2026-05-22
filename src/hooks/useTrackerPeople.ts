import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useTrackerCatalog } from './useTrackerCatalog';

export interface TrackerPerson {
  user_id: string;
  display_name: string;
  email: string | null;
}

export const trackerPeopleKey = ['tracker', 'people'] as const;

// Aggregates project members across every project I can see.
// Used to populate the Reports page user/team filter dropdowns with real names.
export function useTrackerPeople() {
  const { data: catalog } = useTrackerCatalog();
  return useQuery({
    queryKey: trackerPeopleKey,
    enabled: !!catalog,
    queryFn: async (): Promise<TrackerPerson[]> => {
      if (!catalog) return [];
      const byId = new Map<string, TrackerPerson>();

      const results = await Promise.all(
        catalog.projects.map((p) =>
          supabase.rpc('project_members_list', { p_project: p.id }).then((r) => r.data ?? []),
        ),
      );

      for (const list of results) {
        for (const m of list as Array<{
          user_id: string;
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
        }>) {
          if (byId.has(m.user_id)) continue;
          const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
          byId.set(m.user_id, {
            user_id: m.user_id,
            display_name: m.display_name || full || m.email || 'Unknown',
            email: m.email ?? null,
          });
        }
      }
      return Array.from(byId.values()).sort((a, b) => a.display_name.localeCompare(b.display_name));
    },
  });
}
