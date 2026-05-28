import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { CalendarRange as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isoDow, parseDate, toDateString, type WorkCalendar } from '@/components/gantt/ganttUtils';

interface Props {
  value: string | null;
  calendar: WorkCalendar;
  disabled?: boolean;
  placeholder?: string;
  // Earliest legal date (inclusive). Picker disables dates before this; text
  // input rejects them and reverts. Used by date inputs gated by an ASAP
  // dependency binding.
  minDate?: string | null;
  onChange: (v: string | null) => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalize(v: string): string {
  return v.trim().replace(/\//g, '-');
}

export function WorkingDayPicker({
  value,
  calendar,
  disabled = false,
  placeholder = 'yyyy-mm-dd',
  minDate,
  onChange,
}: Props) {
  const display = value ?? '';
  const [text, setText] = React.useState(display);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => setText(display), [display]);

  const selected = React.useMemo(() => parseDate(value) ?? undefined, [value]);
  const minDateObj = React.useMemo(() => (minDate ? parseDate(minDate) ?? undefined : undefined), [minDate]);

  const dayDisabled = React.useCallback(
    (d: Date) => {
      if (!calendar.weekly.has(isoDow(d))) return true;
      if (calendar.nonWorking.has(toDateString(d))) return true;
      if (minDateObj && d.getTime() < minDateObj.getTime()) return true;
      return false;
    },
    [calendar, minDateObj],
  );

  function commit() {
    const v = normalize(text);
    if (v === display) return;
    if (v === '') {
      onChange(null);
      return;
    }
    if (!DATE_RE.test(v)) {
      setText(display);
      return;
    }
    const d = new Date(v + 'T00:00:00');
    if (isNaN(d.getTime())) {
      setText(display);
      return;
    }
    if (minDate && v < minDate) {
      setText(display);
      return;
    }
    onChange(v);
  }

  return (
    <div
      className={cn(
        'h-9 w-full rounded-md border border-neutral-300 bg-white pr-1 pl-3 flex items-center gap-1',
        'dark:border-neutral-700 dark:bg-neutral-900',
        'focus-within:ring-2 focus-within:ring-neutral-400 dark:focus-within:ring-neutral-500',
        disabled && 'opacity-50',
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(display);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500 disabled:cursor-not-allowed"
      />
      <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="shrink-0 p-1 rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:cursor-not-allowed"
          >
            <CalendarIcon size={14} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            data-keep-drawer
            className="z-50 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-2"
          >
            <DayPicker
              mode="single"
              weekStartsOn={1}
              showOutsideDays
              selected={selected}
              defaultMonth={selected}
              disabled={dayDisabled}
              onSelect={(d) => {
                if (!d) return;
                onChange(toDateString(d));
                setOpen(false);
              }}
              className="text-neutral-900 dark:text-neutral-100"
              classNames={{
                months: 'relative',
                month: 'space-y-2',
                month_caption: 'flex items-center justify-center h-8 px-8',
                caption_label: 'text-sm font-medium',
                nav: 'absolute top-0 inset-x-0 flex items-center justify-between h-8',
                button_previous:
                  'inline-flex items-center justify-center h-7 w-7 rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                button_next:
                  'inline-flex items-center justify-center h-7 w-7 rounded text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                chevron: 'fill-neutral-500 dark:fill-neutral-400',
                month_grid: 'border-collapse',
                weekdays: 'flex',
                weekday: 'w-9 h-8 flex items-center justify-center text-[11px] font-medium text-neutral-500 dark:text-neutral-400',
                week: 'flex',
                day: 'p-0',
                day_button:
                  'h-9 w-9 rounded-md text-sm font-normal hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-500',
                selected:
                  '[&>button]:bg-blue-600 [&>button]:text-white [&>button]:hover:bg-blue-700 dark:[&>button]:bg-blue-600',
                today: '[&>button]:font-semibold [&>button]:text-blue-600 dark:[&>button]:text-blue-400',
                disabled: '[&>button]:text-neutral-300 dark:[&>button]:text-neutral-700 [&>button]:cursor-not-allowed [&>button]:line-through [&>button]:hover:bg-transparent',
                outside: '[&>button]:text-neutral-300 dark:[&>button]:text-neutral-600',
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
