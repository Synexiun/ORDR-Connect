import { useContext } from 'react';
import { ToastContext } from '../components/ui/Toast';

export function useToast(): {
  toast: (message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
} {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
