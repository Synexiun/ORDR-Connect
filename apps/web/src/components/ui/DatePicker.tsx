import { type ReactNode, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { cn } from '../../lib/cn';
import { Calendar, ChevronLeft, ChevronRight } from '../icons';

interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Select date',
  className,
}: DatePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    value ? value.getMonth() : new Date().getMonth(),
  );
  const [viewYear, setViewYear] = useState(() =>
    value ? value.getFullYear() : new Date().getFullYear(),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const inputId = label !== undefined ? label.toLowerCase().replace(/\s+/g, '-') : undefined;

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }, []);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: Array<{ date: Date; inMonth: boolean }> = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({
        date: new Date(viewYear, viewMonth - 1, daysInPrevMonth - i),
        inMonth: false,
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: new Date(viewYear, viewMonth, d),
        inMonth: true,
      });
    }

    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        date: new Date(viewYear, viewMonth + 1, d),
        inMonth: false,
      });
    }

    return cells;
  }, [viewMonth, viewYear]);

  const today = useMemo(() => new Date(), []);

  return (
    <div ref={containerRef} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      <div className="space-y-1.5">
        {label !== undefined && (
          <label htmlFor={inputId} className="block text-sm font-medium text-content-secondary">
            {label}
          </label>
        )}
        <button
          type="button"
          id={inputId}
          onClick={() => {
            setOpen((prev) => !prev);
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm',
            'transition-colors duration-150',
            'focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus',
            value ? 'text-content' : 'text-content-tertiary',
          )}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Calendar className="h-4 w-4 text-content-secondary" aria-hidden="true" />
          {value ? formatDate(value) : placeholder}
        </button>
      </div>

      {open && (
        <div
          className={cn(
            'absolute z-50 mt-1.5 w-72 rounded-lg border border-border bg-surface-secondary p-3 shadow-xl',
            'animate-fade-in',
          )}
          role="dialog"
          aria-label="Choose date"
        >
          {/* Month navigation */}
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded-md p-1 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-content">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => {
                nextMonth();
              }}
              className="rounded-md p-1 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="mb-1 grid grid-cols-7 gap-0">
            {DAYS.map((day) => (
              <div key={day} className="py-1 text-center text-xs font-medium text-content-tertiary">
                {day}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0" role="grid">
            {calendarDays.map((cell, idx) => {
              const isSelected = value !== null && isSameDay(cell.date, value);
              const isToday = isSameDay(cell.date, today);

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onChange(cell.date);
                    setOpen(false);
                  }}
                  className={cn(
                    'mx-auto flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors duration-100',
                    cell.inMonth ? 'text-content' : 'text-content-tertiary',
                    isSelected
                      ? 'bg-brand-accent text-[#060608]'
                      : isToday
                        ? 'bg-surface-tertiary font-semibold'
                        : 'hover:bg-surface-tertiary',
                  )}
                  aria-label={formatDate(cell.date)}
                  aria-selected={isSelected || undefined}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
              className="w-full rounded-md py-1.5 text-center text-xs font-medium text-brand-accent transition-colors hover:bg-surface-tertiary"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
