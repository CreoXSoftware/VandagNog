import { createContext, useContext } from 'react';
import type { Organization } from '@/types/db';

// The organization picked in the top bar. Projects, tasks, workload, clients
// and time tracking all show this org only. Provided by CurrentOrgProvider.

export interface CurrentOrgCtx {
  org: Organization;
  orgs: Organization[];
  setOrgId: (id: string) => void;
}

export const CurrentOrgContext = createContext<CurrentOrgCtx | null>(null);

export function useCurrentOrg(): CurrentOrgCtx {
  const v = useContext(CurrentOrgContext);
  if (!v) throw new Error('useCurrentOrg must be inside CurrentOrgProvider');
  return v;
}
