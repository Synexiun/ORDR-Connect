import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import { cn } from '../../lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeStyles = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  size = 'md',
}: ModalProps): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else {
      dialog.close();
      previousFocusRef.current?.focus();
    }
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'fixed inset-0 m-auto rounded-xl border border-border bg-surface-secondary p-0 shadow-2xl',
        'backdrop:bg-black/60',
        'animate-fade-in',
        sizeStyles[size],
        'w-[calc(100%-2rem)]',
      )}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      aria-labelledby="modal-title"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="modal-title" className="text-base font-semibold text-content">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
            aria-label="Close dialog"
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {'\u2715'}
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">{children}</div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            {actions}
          </div>
        )}
      </div>
    </dialog>
  );
}
