import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-white text-[#09090b] hover:bg-white/90 shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset] disabled:bg-white/30 disabled:text-black/60 disabled:shadow-none",
  secondary:
    "border border-sd-lineStrong bg-sd-elevated/70 text-sd-ink hover:border-white/30 hover:bg-sd-elevated disabled:opacity-40",
  ghost:
    "bg-transparent text-sd-inkMuted hover:text-sd-ink hover:bg-white/5 disabled:opacity-40",
  danger:
    "border border-red-400/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-xs",
  md: "min-h-[40px] px-4 py-2 text-sm",
  lg: "min-h-[44px] px-6 py-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-canvas disabled:cursor-not-allowed disabled:active:translate-y-0 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
