import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState({ session: data.session, user: data.session?.user ?? null, loading: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signInWithEmail(email: string, redirectTo?: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo ?? window.location.origin },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}
