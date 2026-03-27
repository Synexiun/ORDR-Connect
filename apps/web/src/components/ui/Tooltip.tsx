import { type ReactNode, useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/cn';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: TooltipPosition;
}

const positionStyles: Record<TooltipPosition, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const arrowStyles: Record<TooltipPosition, string> = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-surface-tertiary border-l-transparent border-r-transparent border-b-transparent',
  bottom:
    'bottom-full left-1/2 -translate-x-1/2 border-b-surface-tertiary border-l-transparent border-r-transparent border-t-transparent',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-surface-tertiary border-t-transparent border-b-transparent border-r-transparent',
  right:
    'right-full top-1/2 -translate-y-1/2 border-r-surface-tertiary border-t-transparent border-b-transparent border-l-transparent',
};

const SHOW_DELAY = 200;

export function Tooltip({ content, children, position = 'top' }: TooltipProps): ReactNode {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-surface-tertiary px-2.5 py-1.5 text-xs font-medium text-content shadow-lg',
            'animate-fade-in pointer-events-none',
            positionStyles[position],
          )}
        >
          {content}
          <span className={cn('absolute border-4', arrowStyles[position])} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
