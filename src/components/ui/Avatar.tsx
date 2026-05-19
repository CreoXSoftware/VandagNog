import { cn } from '@/lib/utils';
import { avatarHue, displayName, initials, type DisplayUser } from '@/lib/userDisplay';

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizeClass: Record<Size, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

interface Props {
  user: DisplayUser | null | undefined;
  size?: Size;
  className?: string;
  title?: string;
}

export function Avatar({ user, size = 'md', className, title }: Props) {
  const init = initials(user);
  const hue = avatarHue(user?.user_id ?? user?.email ?? init);
  const bg = `hsl(${hue} 60% 88%)`;
  const fg = `hsl(${hue} 55% 30%)`;
  return (
    <div
      title={title ?? displayName(user)}
      className={cn(
        'shrink-0 rounded-full flex items-center justify-center font-semibold select-none',
        sizeClass[size],
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
    >
      {init}
    </div>
  );
}
