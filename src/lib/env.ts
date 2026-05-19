function required(key: string, val: string | undefined): string {
  if (!val) throw new Error(`Missing env var: ${key}. Copy .env.example to .env and fill it.`);
  return val;
}

export const env = {
  SUPABASE_URL: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  SUPABASE_ANON_KEY: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
  APP_URL:
    import.meta.env.VITE_APP_URL ||
    window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''),
};
