/**
 * ContextualHelp — Small help icon button with popover tooltip.
 *
 * Usage: <ContextualHelp topic="SLA" content="Service Level Agreement targets..." />
 *
 * COMPLIANCE: No PHI in help content (Rule 6).
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { HelpCircle, X } from '../icons';
import { cn } from '../../lib/cn';

interface ContextualHelpProps {
  topic: string;
  content: string;
  className?: string;
}

export function ContextualHelp({ topic, content, className }: ContextualHelpProps): ReactNode {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={cn('relative inline-flex', className)}>
      <button
        ref={buttonRef}
        onClick={toggle}
        className={cn(
          'inline-flex items-center justify-center rounded-full p-1',
          'text-content-tertiary transition-colors duration-150',
          'hover:bg-surface-tertiary hover:text-content',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        )}
        aria-label={`Help: ${topic}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Help for ${topic}`}
          className={cn(
            'absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2',
            'rounded-lg border border-border bg-surface-secondary p-4 shadow-lg',
            'animate-fade-in',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-content">{topic}</h4>
            <button
              onClick={() => {
                setOpen(false);
              }}
              className="shrink-0 rounded p-0.5 text-content-tertiary transition-colors hover:text-content"
              aria-label="Close help"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-content-secondary">{content}</p>

          {/* Arrow */}
          <div
            className="absolute left-1/2 top-full -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-border"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
