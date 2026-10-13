import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useMyOrgs } from '@/hooks/useOrgs';
import { profileKey, useProfile } from '@/hooks/useProfile';
import { CurrentOrgContext, type CurrentOrgCtx } from '@/lib/currentOrg';
import type { UserSettings } from '@/types/db';

// The choice is saved in user_settings.current_org_id so it follows the user to
// other devices; localStorage only covers a save that didn't make it.
const STORAGE_KEY = 'vn.currentOrg';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode: the DB copy still remembers it
  }
}

// Renders its children only once the current org is known, so every page
// inside can rely on useCurrentOrg() having one.
export function CurrentOrgProvider({
  children,
  loading,
  failed,
}: {
  children: ReactNode;
  loading: ReactNode;
  failed: (message: string) => ReactNode;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: orgs, error } = useMyOrgs();
  const { data: profile, isFetched: profileFetched } = useProfile(user?.id);
  const [stored] = useState(readStored);
  // Picked in this tab; until then the saved choice applies.
  const [pickedId, setPickedId] = useState<string | null>(null);

  const setOrgId = useCallback(
    (id: string) => {
      setPickedId(id);
      writeStored(id);
      if (!user) return;
      qc.setQueryData<UserSettings | null>(profileKey(user.id), (old) =>
        old ? { ...old, current_org_id: id } : old,
      );
      void supabase
        .from('user_settings')
        .upsert({ user_id: user.id, current_org_id: id }, { onConflict: 'user_id' })
        .then(({ error: e }) => {
          if (e) console.warn('[currentOrg] could not save the selected organization:', e.message);
        });
    },
    [qc, user],
  );

  // A saved org I'm no longer in falls back to the first shared org, then Personal.
  const wantedId = pickedId ?? profile?.current_org_id ?? stored;
  const org = useMemo(() => {
    if (!orgs || orgs.length === 0) return null;
    return orgs.find((o) => o.id === wantedId) ?? orgs.find((o) => !o.is_personal) ?? orgs[0];
  }, [orgs, wantedId]);

  const value = useMemo<CurrentOrgCtx | null>(
    () => (org && orgs ? { org, orgs, setOrgId } : null),
    [org, orgs, setOrgId],
  );

  if (error) return <>{failed((error as Error).message)}</>;
  // Wait for the saved choice too, so the first page shown is the right org's.
  if (!value || !profileFetched) return <>{loading}</>;
  return <CurrentOrgContext.Provider value={value}>{children}</CurrentOrgContext.Provider>;
}
