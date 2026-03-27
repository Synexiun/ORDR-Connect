import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type ToggleSize = 'sm' | 'md';

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: ToggleSize;
}

const trackSize: Record<ToggleSize, string> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
};

const thumbSize: Record<ToggleSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4.5 w-4.5',
};

const thumbTranslate: Record<ToggleSize, string> = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
};

export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
  size = 'md',
}: ToggleProps): ReactNode {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'relative inline-flex shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          trackSize[size],
          checked ? 'bg-brand-accent' : 'bg-surface-tertiary',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
            thumbSize[size],
            checked ? thumbTranslate[size] : 'translate-x-0.5',
          )}
          aria-hidden="true"
        />
      </button>
      {label !== undefined && <span className="text-sm text-content">{label}</span>}
    </label>
  );
}
