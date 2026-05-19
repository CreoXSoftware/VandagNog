import * as React from 'react';
import { cn } from '@/lib/utils';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm',
        'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
        'focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
