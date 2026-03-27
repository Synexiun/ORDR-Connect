import { type TextareaHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../../lib/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

const resizeStyles: Record<string, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, resize = 'vertical', className, id, maxLength, ...props },
  ref,
): ReactNode {
  const textareaId =
    id !== undefined
      ? id
      : label !== undefined
        ? label.toLowerCase().replace(/\s+/g, '-')
        : undefined;
  const errorId = error !== undefined ? `${textareaId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      {label !== undefined && (
        <label htmlFor={textareaId} className="block text-sm font-medium text-content-secondary">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        maxLength={maxLength}
        className={cn(
          'block w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-content',
          'placeholder:text-content-tertiary',
          'transition-colors duration-150',
          'focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error !== undefined ? 'border-brand-danger' : 'border-border',
          resizeStyles[resize],
          className,
        )}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={errorId}
        {...props}
      />
      <div className="flex items-center justify-between">
        {error !== undefined ? (
          <p id={errorId} className="text-xs text-brand-danger" role="alert">
            {error}
          </p>
        ) : (
          <span />
        )}
        {maxLength !== undefined && (
          <span className="text-xs text-content-tertiary">
            {typeof props.value === 'string' ? props.value.length : 0}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});
