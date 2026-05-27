import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}

export function Drawer({ open, onClose, title, children, widthClass = 'w-[480px]' }: DrawerProps) {
  const t = useT();
  const asideRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // keep open when interacting with the drawer itself, the work-item
      // widget rows, or the gantt bars (so editing/dragging keeps detail visible)
      if (asideRef.current?.contains(target)) return;
      if (target.closest('[data-keep-drawer],[data-sonner-toaster]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 pointer-events-none">
      <aside
        ref={asideRef}
        className={cn(
          'pointer-events-auto h-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100',
          'border-l border-neutral-200 dark:border-neutral-800 shadow-xl flex flex-col',
          widthClass,
        )}
        role="dialog"
        aria-modal="false"
      >
        <header className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded text-neutral-500 dark:text-neutral-400"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
