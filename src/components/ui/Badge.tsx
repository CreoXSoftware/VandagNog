import { cn } from '@/lib/utils';
import { levelStyle } from '@/lib/levels';

const roleClass: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  editor: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  viewer: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  default: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

interface BadgeProps {
  children: React.ReactNode;
  kind?: string | number;
  className?: string;
}

export function Badge({ children, kind, className }: BadgeProps) {
  // When the caller supplies className, treat it as the authoritative palette.
  // Otherwise applying a default `dark:bg-neutral-800` here would override the
  // caller's `bg-[#hex]` in dark mode (tailwind-merge keeps dark: variants).
  let palette = '';
  if (!className) {
    if (typeof kind === 'number') {
      const s = levelStyle(kind);
      palette = `${s.bg} ${s.text}`;
    } else {
      palette = roleClass[kind ?? 'default'] ?? roleClass.default;
    }
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
        palette,
        className,
      )}
    >
      {children}
    </span>
  );
}
