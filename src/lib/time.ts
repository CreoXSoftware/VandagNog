type Lang = 'en' | 'af';

function currentLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const l = localStorage.getItem('vn.lang');
  return l === 'af' ? 'af' : 'en';
}

const phrases: Record<Lang, { justNow: string; ago: (s: string) => string; in: (s: string) => string }> = {
  en: { justNow: 'just now', ago: (s) => `${s} ago`, in: (s) => `in ${s}` },
  af: { justNow: 'nou net', ago: (s) => `${s} gelede`, in: (s) => `oor ${s}` },
};

export function formatDistanceToNow(d: Date | string, opts?: { addSuffix?: boolean }): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Math.round((Date.now() - date.getTime()) / 1000);
  const lang = currentLang();
  const p = phrases[lang];
  const suffix = (s: string) => (opts?.addSuffix ? (diff < 0 ? p.in(s) : p.ago(s)) : s);
  const abs = Math.abs(diff);
  if (abs < 60) return opts?.addSuffix ? p.justNow : '0s';
  if (abs < 3600) return suffix(`${Math.round(abs / 60)}m`);
  if (abs < 86400) return suffix(`${Math.round(abs / 3600)}h`);
  if (abs < 604800) return suffix(`${Math.round(abs / 86400)}d`);
  if (abs < 2592000) return suffix(`${Math.round(abs / 604800)}w`);
  if (abs < 31536000) return suffix(`${Math.round(abs / 2592000)}mo`);
  return suffix(`${Math.round(abs / 31536000)}y`);
}
