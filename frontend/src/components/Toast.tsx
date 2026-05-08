import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

let addToastFn: ((toast: Omit<Toast, 'id'>) => void) | null = null;

export const toast = {
  success: (message: string, duration = 3000) => {
    addToastFn?.({ type: 'success', message, duration });
  },
  error: (message: string, duration = 5000) => {
    addToastFn?.({ type: 'error', message, duration });
  },
  warning: (message: string, duration = 4000) => {
    addToastFn?.({ type: 'warning', message, duration });
  },
  info: (message: string, duration = 3000) => {
    addToastFn?.({ type: 'info', message, duration });
  },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    addToastFn = (toast) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setToasts((prev) => [...prev, { ...toast, id }]);

      if (toast.duration && toast.duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, toast.duration);
      }
    };

    return () => {
      addToastFn = null;
    };
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  type,
  message,
  onClose,
}: Toast & { onClose: () => void }) {
  const typeClasses = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-orange-500',
    info: 'bg-blue-500',
  };

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <div
      className={`${typeClasses[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-72 max-w-96 animate-slide-in-right`}
    >
      <span className="font-bold">{icons[type]}</span>
      <p className="flex-1 text-sm">{message}</p>
      <button onClick={onClose} className="text-white/80 hover:text-white">
        ×
      </button>
    </div>
  );
}