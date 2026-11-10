import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-white text-black hover:bg-white/90 disabled:bg-white/30 disabled:text-black/60",
  secondary:
    "border border-white/20 bg-transparent text-white hover:border-white/50 hover:bg-white/5 disabled:opacity-40",
  ghost: "bg-transparent text-white/80 hover:text-white hover:bg-white/5 disabled:opacity-40",
  danger:
    "border border-red-400/40 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-sm",
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
