import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function currentLocale(): string {
  if (typeof window === 'undefined') return 'en-US';
  const l = localStorage.getItem('vn.lang');
  return l === 'af' ? 'af-ZA' : 'en-US';
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(currentLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00Z').getTime();
  const d2 = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function toDateInput(d: string | null | undefined): string {
  if (!d) return '';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

export function uuidShort(id: string): string {
  return id.slice(0, 8);
}
