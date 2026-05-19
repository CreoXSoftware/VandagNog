import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '@/lib/supabase';
import { useT } from '@/lib/i18n';

export function AuthCallbackPage() {
  const nav = useNavigate();
  const t = useT();
  useEffect(() => {
    supabase.auth.getSession().then(() => {
      nav({ to: '/projects' });
    });
  }, [nav]);
  return <div className="p-8 text-sm text-neutral-500 dark:text-neutral-400">{t('auth.signingIn')}</div>;
}
