import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyableHash({
  value,
  displayValue,
  label,
  className = "",
}: {
  readonly value: string;
  readonly displayValue?: string;
  readonly label?: string;
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className="font-mono text-sd-ink truncate" title={value}>
        {displayValue ?? value}
      </span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={label ? `Copy ${label}` : "Copy value"}
        title={copied ? "Copied" : label ? `Copy ${label}` : "Copy value"}
        className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md p-1.5 text-sd-inkMuted transition-colors hover:bg-white/10 hover:text-sd-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-canvas"
      >
        {copied ? (
          <Check size={14} strokeWidth={1.75} className="text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
