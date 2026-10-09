// Name matching for import mapping: exact (case/space-insensitive) matches are
// taken automatically; anything merely similar is only ever suggested, so the
// user decides.

export function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function squash(s: string): string {
  return normName(s).replace(/[^a-z0-9]/g, '');
}

function tokens(s: string): Set<string> {
  return new Set(normName(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1, where 1 means the same name apart from case and spacing. */
export function similarity(a: string, b: string): number {
  if (normName(a) === normName(b)) return 1;
  const sa = squash(a);
  const sb = squash(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 0.95; // differs only in punctuation, e.g. "P01011-iStockpile"
  let best = 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length);
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length >= 3 && long.includes(short)) best = Math.max(best, 0.75);
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size && tb.size) {
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    best = Math.max(best, shared / (ta.size + tb.size - shared));
  }
  return best;
}

export const SUGGEST_THRESHOLD = 0.6;

export interface Candidate<T> {
  item: T;
  score: number;
}

/** Exact matches (score 1) first, then up to `limit` similar ones. */
export function rankCandidates<T>(
  name: string,
  items: T[],
  nameOf: (t: T) => string,
  limit = 3,
): { exact: Candidate<T>[]; similar: Candidate<T>[] } {
  const scored = items
    .map((item) => ({ item, score: similarity(name, nameOf(item)) }))
    .filter((c) => c.score >= SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return {
    exact: scored.filter((c) => c.score === 1),
    similar: scored.filter((c) => c.score < 1).slice(0, limit),
  };
}
