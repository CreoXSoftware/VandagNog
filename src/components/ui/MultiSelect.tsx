import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export interface MultiSelectItem {
  id: string;
  label: string;
}

interface Props {
  icon?: React.ReactNode;
  label: string;
  items: MultiSelectItem[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  clearLabel: string;
  align?: 'start' | 'center' | 'end';
}

// Compact filter chip that opens a checkbox list. Selected state is signalled by
// the blue tint plus a count, matching the rest of the filter bars.
export function MultiSelect({
  icon,
  label,
  items,
  selected,
  setSelected,
  clearLabel,
  align = 'end',
}: Props) {
  function toggle(id: string) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 h-7 px-2 rounded text-[11px]',
            selected.length > 0
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700',
          )}
        >
          {icon}
          {label}
          {selected.length > 0 && <span className="tabular-nums">· {selected.length}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align={align}
          sideOffset={4}
          className="z-50 w-56 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-2"
        >
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {items.length === 0 && (
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400 px-1.5 py-1">—</div>
            )}
            {items.map((it) => (
              <label
                key={it.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(it.id)}
                  onChange={() => toggle(it.id)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1 truncate">{it.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              className="mt-2 w-full h-7 rounded text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {clearLabel}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
