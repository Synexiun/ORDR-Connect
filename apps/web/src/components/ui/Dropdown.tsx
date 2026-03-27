import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '../../lib/cn';

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, items, align = 'right' }: DropdownProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setFocusIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || focusIndex < 0) return;
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons?.[focusIndex]?.focus();
  }, [open, focusIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
          setFocusIndex(0);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusIndex((prev) => (prev + 1) % items.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIndex((prev) => (prev - 1 + items.length) % items.length);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < items.length) {
            const item = items[focusIndex];
            if (item) {
              item.onClick();
            }
            close();
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'Tab':
          close();
          break;
      }
    },
    [open, focusIndex, items, close],
  );

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <div
        onClick={() => {
          setOpen((prev) => !prev);
          if (!open) setFocusIndex(-1);
        }}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </div>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            'absolute z-50 mt-1.5 min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface-secondary py-1 shadow-xl',
            'animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, idx) => (
            <button
              key={item.label}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                item.onClick();
                close();
              }}
              onMouseEnter={() => {
                setFocusIndex(idx);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors duration-100',
                'focus:bg-surface-tertiary focus:outline-none',
                'hover:bg-surface-tertiary',
                item.danger === true
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-content hover:text-content',
              )}
            >
              {item.icon !== undefined && (
                <span className="shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
