import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ToastContext, type ToastContextValue, type ToastTone } from "./toast-context";

interface ToastItem {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title?: string;
  readonly message: string;
}

const TONE_STYLES: Record<
  ToastTone,
  { border: string; iconClass: string; titleClass: string }
> = {
  error: {
    border: "border-red-400/40",
    iconClass: "text-red-400",
    titleClass: "text-red-200",
  },
  success: {
    border: "border-emerald-400/40",
    iconClass: "text-emerald-400",
    titleClass: "text-emerald-200",
  },
  info: {
    border: "border-sd-accent/40",
    iconClass: "text-sd-accent",
    titleClass: "text-white",
  },
};

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const seqRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const pushToast = useCallback(
    (tone: ToastTone, title: string | undefined, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      seqRef.current += 1;
      const id = `toast-${seqRef.current}`;

      setToasts((prev) => {
        const deduplicated = prev.filter(
          (item) => !(item.tone === tone && item.message === trimmed && item.title === title)
        );
        return [...deduplicated.slice(-3), { id, tone, title, message: trimmed }];
      });

      if (tone !== "error") {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((item) => item.id !== id));
        }, 5000);
        timersRef.current.set(id, timer);
      }
    },
    []
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      pushToast,
      error: (title, message) => pushToast("error", title, message),
      success: (title, message) => pushToast("success", title, message),
      info: (title, message) => pushToast("info", title, message),
      dismiss,
    }),
    [pushToast, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
        >
          {toasts.map((item) => {
            const style = TONE_STYLES[item.tone];
            const Icon =
              item.tone === "error"
                ? AlertCircle
                : item.tone === "success"
                  ? CheckCircle2
                  : Info;
            return (
              <div
                key={item.id}
                role={item.tone === "error" ? "alert" : "status"}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-[#111114]/95 p-3.5 text-sm shadow-2xl backdrop-blur-md ${style.border}`}
              >
                <Icon size={17} className={`mt-0.5 shrink-0 ${style.iconClass}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {item.title && (
                    <p className={`text-xs font-semibold tracking-wide ${style.titleClass}`}>
                      {item.title}
                    </p>
                  )}
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-sd-inkMuted">
                    {item.message}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(item.id)}
                  className="shrink-0 rounded-md p-1 text-sd-inkSubtle transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
