import { AlertTriangle, Check, CircleDot, Info } from "lucide-react";
import type { DealStatus } from "@/types/api";

interface StageDefinition {
  readonly key: "CREATED" | "FUNDED" | "DELIVERED" | "RELEASED";
  readonly label: string;
}

const CORE_STAGES: readonly StageDefinition[] = [
  { key: "CREATED", label: "Created" },
  { key: "FUNDED", label: "Funded" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "RELEASED", label: "Released" },
];

type StageState = "completed" | "active" | "upcoming";

interface BranchBanner {
  readonly tone: "neutral" | "warning" | "danger" | "success";
  readonly title: string;
  readonly description: string;
}

function getBranchBanner(status: DealStatus): BranchBanner | null {
  switch (status) {
    case "DRAFT":
      return {
        tone: "neutral",
        title: "Off-Chain Draft",
        description: "Terms are prepared off-chain and awaiting Seller on-chain creation.",
      };
    case "CANCELLED":
      return {
        tone: "neutral",
        title: "Deal Cancelled",
        description: "This unfunded escrow was cancelled on-chain before funding.",
      };
    case "REFUNDED":
      return {
        tone: "warning",
        title: "Funds Refunded",
        description: "Escrowed funds were returned to the buyer.",
      };
    case "DISPUTED":
      return {
        tone: "danger",
        title: "Dispute Active",
        description: "Escrow settlement is paused pending arbiter resolution.",
      };
    case "RESOLVED":
      return {
        tone: "success",
        title: "Arbitration Resolved",
        description: "The arbiter has finalized the split and awards are ready to withdraw.",
      };
    default:
      return null;
  }
}

function resolveStageStates(status: DealStatus): readonly StageState[] {
  switch (status) {
    case "CREATED":
      return ["active", "upcoming", "upcoming", "upcoming"];
    case "FUNDED":
      return ["completed", "active", "upcoming", "upcoming"];
    case "DELIVERED":
      return ["completed", "completed", "active", "upcoming"];
    case "RELEASED":
      return ["completed", "completed", "completed", "completed"];
    case "DRAFT":
      return ["upcoming", "upcoming", "upcoming", "upcoming"];
    case "CANCELLED":
      return ["completed", "upcoming", "upcoming", "upcoming"];
    case "REFUNDED":
    case "DISPUTED":
    case "RESOLVED":
      return ["completed", "completed", "upcoming", "upcoming"];
  }
}

export function DealLifecycleStepper({ status }: { readonly status: DealStatus }) {
  const states = resolveStageStates(status);
  const branch = getBranchBanner(status);

  return (
    <div className="space-y-3">
      <ol aria-label="Escrow lifecycle progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CORE_STAGES.map((stage, index) => {
          const state = states[index]!;
          const isCurrent =
            state === "active" || (status === "RELEASED" && stage.key === "RELEASED");

          const cardStyle =
            state === "completed"
              ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
              : state === "active"
                ? "border-sd-accent bg-sd-elevated text-white shadow-[0_0_0_1px_rgba(16,185,129,0.2)]"
                : "border-sd-line bg-sd-inset text-sd-inkSubtle";

          return (
            <li
              key={stage.key}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors ${cardStyle}`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${
                  state === "completed"
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : state === "active"
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                      : "border-sd-line text-sd-inkSubtle"
                }`}
                aria-hidden="true"
              >
                {state === "completed" ? (
                  <Check size={12} strokeWidth={2} />
                ) : state === "active" ? (
                  <CircleDot size={12} strokeWidth={2} />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{stage.label}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider opacity-75">
                  {state === "completed" ? "Done" : state === "active" ? "Current" : "Pending"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {branch && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${
            branch.tone === "danger"
              ? "border-red-400/35 bg-red-500/10 text-red-100"
              : branch.tone === "warning"
                ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                : branch.tone === "success"
                  ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                  : "border-sd-line bg-sd-inset text-sd-inkMuted"
          }`}
        >
          {branch.tone === "danger" || branch.tone === "warning" ? (
            <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <Info size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <div>
            <span className="font-medium">{branch.title}: </span>
            <span className="opacity-90">{branch.description}</span>
          </div>
        </div>
      )}
    </div>
  );
}
