import * as React from 'react';
import * as RD from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

interface DialogContentProps extends Omit<React.ComponentPropsWithoutRef<typeof RD.Content>, 'title'> {
  title?: React.ReactNode;
}

export function DialogContent({ className, children, title, ...props }: DialogContentProps) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <RD.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-[440px] max-w-[95vw] max-h-[90vh] overflow-auto rounded-lg shadow-xl p-5',
          'bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100',
          className,
        )}
        {...props}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <RD.Title className="text-base font-semibold">{title}</RD.Title>
            <RD.Close className="p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded">
              <X size={16} />
            </RD.Close>
          </div>
        )}
        {children}
      </RD.Content>
    </RD.Portal>
  );
}
