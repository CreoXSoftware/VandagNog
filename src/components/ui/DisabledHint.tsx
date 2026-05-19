import * as React from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from './Tooltip';

interface Props {
  disabled: boolean;
  reason: string | null;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wrap a disabled form control so hovering it shows a tooltip explaining why.
 * Disabled inputs swallow pointer events, so children are wrapped in a span with
 * pointer-events:none, and the outer span (which receives hover) acts as trigger.
 */
export function DisabledHint({ disabled, reason, children, className }: Props) {
  if (!disabled || !reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block w-full cursor-not-allowed ${className ?? ''}`} tabIndex={0}>
          <span className="block pointer-events-none">{children}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
