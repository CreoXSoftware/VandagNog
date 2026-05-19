import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type Dict } from './en';
import { af } from './af';

export type Lang = 'en' | 'af';

const dicts: Record<Lang, Dict> = { en, af };
const STORAGE_KEY = 'vn.lang';

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

// Build dotted-path key type from Dict
type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = T extends string
  ? never
  : { [K in keyof T]: K extends string ? T[K] extends string ? K : Join<K, Paths<T[K]>> : never }[keyof T];
export type TKey = Paths<Dict>;

function initial(): Lang {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'af') return saved;
  const nav = navigator.language?.toLowerCase() ?? '';
  if (nav.startsWith('af')) return 'af';
  return 'en';
}

function lookup(dict: Dict, key: string): string {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === 'string' ? cur : key;
}

function interp(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => interp(lookup(dicts[lang], key as string), vars),
    [lang],
  );

  const value = useMemo<I18nCtx>(() => ({ lang, setLang: setLangState, t }), [lang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be inside I18nProvider');
  return v;
}

export function useT() {
  return useI18n().t;
}
