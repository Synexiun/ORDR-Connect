import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../../lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, className, id, ...props },
  ref,
): ReactNode {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helperText && !error ? `${inputId}-helper` : undefined;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-content-secondary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'block w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-content',
          'placeholder:text-content-tertiary',
          'transition-colors duration-150',
          'focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-brand-danger' : 'border-border',
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId || helperId}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-xs text-brand-danger" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={helperId} className="text-xs text-content-tertiary">
          {helperText}
        </p>
      )}
    </div>
  );
});
