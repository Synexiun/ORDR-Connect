import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ChevronDown } from '../icons';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function Select({
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
  placeholder,
  className,
}: SelectProps): ReactNode {
  const selectId = label !== undefined ? label.toLowerCase().replace(/\s+/g, '-') : undefined;
  const errorId = error !== undefined && selectId !== undefined ? `${selectId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      {label !== undefined && (
        <label htmlFor={selectId} className="block text-sm font-medium text-content-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          disabled={disabled}
          className={cn(
            'block w-full appearance-none rounded-lg border bg-surface px-3.5 py-2.5 pr-10 text-sm text-content',
            'transition-colors duration-150',
            'focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error !== undefined ? 'border-brand-danger' : 'border-border',
            className,
          )}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={errorId}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-secondary"
          aria-hidden="true"
        />
      </div>
      {error !== undefined && (
        <p id={errorId} className="text-xs text-brand-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
