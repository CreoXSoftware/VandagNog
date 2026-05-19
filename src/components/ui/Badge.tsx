import { cn } from '@/lib/utils';

const colorClass: Record<string, string> = {
  epic: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  task: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  subtask: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  owner: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  editor: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  viewer: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  default: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

export function Badge({ children, kind, className }: { children: React.ReactNode; kind?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
        colorClass[kind ?? 'default'] ?? colorClass.default,
        className,
      )}
    >
      {children}
    </span>
  );
}
