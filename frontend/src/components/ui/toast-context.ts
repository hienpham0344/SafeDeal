import { createContext, useContext } from "react";

export type ToastTone = "error" | "success" | "info";

export interface ToastContextValue {
  readonly pushToast: (tone: ToastTone, title: string | undefined, message: string) => void;
  readonly error: (title: string, message: string) => void;
  readonly success: (title: string, message: string) => void;
  readonly info: (title: string, message: string) => void;
  readonly dismiss: (id: string) => void;
}

export const NOOP_TOAST: ToastContextValue = {
  pushToast: () => undefined,
  error: () => undefined,
  success: () => undefined,
  info: () => undefined,
  dismiss: () => undefined,
};

export const ToastContext = createContext<ToastContextValue>(NOOP_TOAST);

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

