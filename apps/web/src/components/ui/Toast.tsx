import { type ReactNode, createContext, useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../../lib/cn';
import { CheckCircle2, AlertTriangle, AlertCircle, X, XCircle } from '../icons';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
};

const variantIcons: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
  error: <XCircle className="h-5 w-5 text-red-400" />,
  warning: <AlertTriangle className="h-5 w-5 text-amber-400" />,
  info: <AlertCircle className="h-5 w-5 text-blue-400" />,
};

const TOAST_DURATION = 5000;

function ToastItem({
  toast: t,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}): ReactNode {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss(t.id);
    }, TOAST_DURATION);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [t.id, onDismiss]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-4 shadow-xl',
        'bg-surface-secondary backdrop-blur-sm',
        'animate-fade-in',
        variantStyles[t.variant],
      )}
      role="alert"
      aria-live="assertive"
    >
      <span className="shrink-0" aria-hidden="true">
        {variantIcons[t.variant]}
      </span>
      <p className="flex-1 text-sm text-content">{t.message}</p>
      <button
        onClick={() => {
          onDismiss(t.id);
        }}
        className="shrink-0 rounded p-0.5 text-content-secondary transition-colors hover:text-content"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    toastCounter += 1;
    const id = `toast-${toastCounter}-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
