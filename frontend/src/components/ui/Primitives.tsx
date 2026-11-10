import type { ReactNode } from "react";
import type { DealStatus, DisputeStatus } from "@/types/api";

const DEAL_STATUS_STYLES: Record<DealStatus, string> = {
  DRAFT: "border-white/20 text-white/70 bg-white/5",
  CREATED: "border-white/30 text-white bg-white/10",
  FUNDED: "border-emerald-400/40 text-emerald-200 bg-emerald-500/10",
  DELIVERED: "border-sky-400/40 text-sky-200 bg-sky-500/10",
  RELEASED: "border-emerald-400/60 text-emerald-100 bg-emerald-500/20",
  REFUNDED: "border-amber-400/40 text-amber-200 bg-amber-500/10",
  DISPUTED: "border-red-400/50 text-red-200 bg-red-500/15",
  RESOLVED: "border-white/40 text-white bg-white/15",
  CANCELLED: "border-white/15 text-white/50 bg-transparent",
};

export function StatusBadge({ status }: { readonly status: DealStatus | DisputeStatus }) {
  const style =
    status === "OPEN"
      ? DEAL_STATUS_STYLES.DISPUTED
      : status === "RESOLVED"
        ? DEAL_STATUS_STYLES.RESOLVED
        : DEAL_STATUS_STYLES[status];

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

export function Panel({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`rounded-xl border border-white/15 bg-neutral-950/90 p-6 ${className}`}>
      {children}
    </section>
  );
}

export function AlertBanner({
  tone = "info",
  title,
  message,
  action,
}: {
  readonly tone?: "info" | "warning" | "error" | "success";
  readonly title?: string;
  readonly message: string;
  readonly action?: ReactNode;
}) {
  const toneClasses = {
    info: "border-white/20 bg-white/5 text-white/90",
    warning: "border-amber-400/40 bg-amber-500/10 text-amber-100",
    error: "border-red-400/40 bg-red-500/10 text-red-100",
    success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  }[tone];

  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-sm ${toneClasses}`}>
      <div>
        {title && <p className="font-medium">{title}</p>}
        <p className="opacity-90">{message}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
      <h3 className="text-base font-medium text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { readonly label?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-950 p-8 text-center text-sm text-white/60">
      {label}
    </div>
  );
}
