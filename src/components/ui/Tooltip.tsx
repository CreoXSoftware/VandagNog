import * as React from 'react';
import * as RT from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = RT.Provider;
export const Tooltip = RT.Root;
export const TooltipTrigger = RT.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithoutRef<typeof RT.Content>) {
  return (
    <RT.Portal>
      <RT.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded px-2 py-1 text-xs shadow-md',
          'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      />
    </RT.Portal>
  );
}
