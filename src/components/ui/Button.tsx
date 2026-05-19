import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variantClass: Record<Variant, string> = {
  default:
    'bg-neutral-900 text-neutral-50 hover:bg-neutral-800 disabled:opacity-50 ' +
    'dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
  outline:
    'bg-white border border-neutral-300 text-neutral-900 hover:bg-neutral-100 disabled:opacity-50 ' +
    'dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800',
  ghost:
    'bg-transparent text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 ' +
    'dark:text-neutral-300 dark:hover:bg-neutral-800',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-5 text-base',
  icon: 'h-8 w-8',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-500',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
