import { useQuery } from '@tanstack/react-query';
import { useCurrentOrg } from '@/lib/currentOrg';
import { displayName } from '@/lib/userDisplay';
import { fetchOrgProjectMembers } from './useOrgs';

export interface TrackerPerson {
  user_id: string;
  display_name: string;
  email: string | null;
}

// Prefix for invalidation; the list itself is per organization.
export const trackerPeopleKey = ['tracker', 'people'] as const;

// Everyone with access to a project of the current organization, with real
// names. Used for the Reports page member filter and the report rows.
export function useTrackerPeople() {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: [...trackerPeopleKey, org.id],
    queryFn: async (): Promise<TrackerPerson[]> => {
      const byId = new Map<string, TrackerPerson>();
      for (const m of await fetchOrgProjectMembers(org.id)) {
        if (byId.has(m.user_id)) continue;
        byId.set(m.user_id, {
          user_id: m.user_id,
          display_name: displayName(m),
          email: m.email ?? null,
        });
      }
      return Array.from(byId.values()).sort((a, b) => a.display_name.localeCompare(b.display_name));
    },
  });
}
