import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm',
        'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
        'placeholder:text-neutral-400 dark:placeholder:text-neutral-500',
        'focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-500',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full min-h-[80px] rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm',
        'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
        'placeholder:text-neutral-400 dark:placeholder:text-neutral-500',
        'focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-500',
        'disabled:opacity-50 resize-y',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
