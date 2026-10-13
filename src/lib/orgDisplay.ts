import { useT, type TKey } from '@/lib/i18n';
import type { OrgRole, Organization } from '@/types/db';

export const orgRoleKey: Record<OrgRole, TKey> = {
  owner: 'orgs.roleOwner',
  admin: 'orgs.roleAdmin',
  member: 'orgs.roleMember',
  guest: 'orgs.roleGuest',
};

/** The personal org is stored as "Personal"; show it in the user's language. */
export function useOrgName(): (org: Pick<Organization, 'name' | 'is_personal'>) => string {
  const t = useT();
  return (org) => (org.is_personal ? t('orgs.personal') : org.name);
}
