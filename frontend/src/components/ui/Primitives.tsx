import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Layers } from "lucide-react";
import type { DealStatus, DisputeStatus } from "@/types/api";

interface StatusStyle {
  readonly badge: string;
  readonly dot: string;
}

const DEAL_STATUS_STYLES: Record<DealStatus, StatusStyle> = {
  DRAFT: {
    badge: "border-sd-lineStrong text-sd-inkMuted bg-white/[0.04]",
    dot: "bg-zinc-400",
  },
  CREATED: {
    badge: "border-white/30 text-sd-ink bg-white/[0.08]",
    dot: "bg-white",
  },
  FUNDED: {
    badge: "border-emerald-400/45 text-emerald-200 bg-emerald-500/15",
    dot: "bg-emerald-400",
  },
  DELIVERED: {
    badge: "border-sky-400/45 text-sky-200 bg-sky-500/15",
    dot: "bg-sky-400",
  },
  RELEASED: {
    badge: "border-emerald-400/60 text-emerald-100 bg-emerald-500/20",
    dot: "bg-emerald-300",
  },
  REFUNDED: {
    badge: "border-amber-400/45 text-amber-200 bg-amber-500/15",
    dot: "bg-amber-400",
  },
  DISPUTED: {
    badge: "border-red-400/50 text-red-200 bg-red-500/15",
    dot: "bg-red-400",
  },
  RESOLVED: {
    badge: "border-white/35 text-white bg-white/[0.14]",
    dot: "bg-emerald-400",
  },
  CANCELLED: {
    badge: "border-sd-line text-sd-inkMuted bg-white/[0.02]",
    dot: "bg-zinc-500",
  },
};

export function StatusBadge({ status }: { readonly status: DealStatus | DisputeStatus }) {
  const style =
    status === "OPEN"
      ? DEAL_STATUS_STYLES.DISPUTED
      : status === "RESOLVED"
        ? DEAL_STATUS_STYLES.RESOLVED
        : DEAL_STATUS_STYLES[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}

type PanelVariant = "default" | "elevated" | "inset";

const PANEL_VARIANT_CLASSES: Record<PanelVariant, string> = {
  default:
    "border border-sd-line bg-sd-surface shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]",
  elevated:
    "border border-sd-lineStrong bg-sd-elevated shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]",
  inset: "border border-sd-line bg-sd-inset",
};

export function Panel({
  children,
  variant = "default",
  className = "",
}: {
  readonly children: ReactNode;
  readonly variant?: PanelVariant;
  readonly className?: string;
}) {
  return (
    <section className={`rounded-xl p-6 ${PANEL_VARIANT_CLASSES[variant]} ${className}`}>
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
  const toneConfig = {
    info: {
      container: "border-sd-lineStrong border-l-white/50 bg-sd-elevated/80 text-sd-ink",
      iconClass: "text-sd-inkMuted",
      Icon: Info,
    },
    warning: {
      container: "border-amber-400/35 border-l-amber-400 bg-amber-500/10 text-amber-100",
      iconClass: "text-amber-300",
      Icon: AlertTriangle,
    },
    error: {
      container: "border-red-400/35 border-l-red-400 bg-red-500/10 text-red-100",
      iconClass: "text-red-300",
      Icon: AlertCircle,
    },
    success: {
      container: "border-emerald-400/35 border-l-emerald-400 bg-emerald-500/10 text-emerald-100",
      iconClass: "text-emerald-300",
      Icon: CheckCircle2,
    },
  }[tone];

  const { Icon } = toneConfig;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border border-l-2 p-4 text-sm ${toneConfig.container}`}
    >
      <div className="flex items-start gap-3">
        <Icon size={18} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${toneConfig.iconClass}`} aria-hidden="true" />
        <div className="space-y-0.5">
          {title && <p className="font-medium leading-snug">{title}</p>}
          <p className="opacity-90 leading-relaxed">{message}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
    <div className="rounded-xl border border-sd-line bg-sd-surface p-10 text-center shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-sd-line bg-sd-inset text-sd-inkMuted">
        <Layers size={18} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h3 className="text-base font-medium text-white text-balance">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-sd-inkMuted">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading..." }: { readonly label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-sd-line bg-sd-surface p-6 space-y-4 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]"
    >
      <div className="space-y-3 animate-pulse" aria-hidden="true">
        <div className="flex items-center justify-between gap-4">
          <div className="h-4 w-44 rounded bg-white/[0.08]" />
          <div className="h-5 w-20 rounded-full bg-white/[0.06]" />
        </div>
        <div className="h-14 w-full rounded-lg border border-sd-line bg-sd-inset/80" />
        <div className="h-14 w-full rounded-lg border border-sd-line bg-sd-inset/80" />
      </div>
      <p className="text-xs font-mono text-sd-inkSubtle">{label}</p>
    </div>
  );
}
