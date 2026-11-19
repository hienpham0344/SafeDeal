import { AlertTriangle, Check, CircleDot, Info } from "lucide-react";
import type { DealStatus } from "@/types/api";

type StageState = "completed" | "active" | "upcoming";

interface ResolvedStage {
  readonly key: string;
  readonly label: string;
  readonly state: StageState;
}

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

function resolveStages(status: DealStatus, deliveredAt?: string | null): readonly ResolvedStage[] {
  switch (status) {
    case "CREATED":
      return [
        { key: "CREATED", label: "Created", state: "active" },
        { key: "FUNDED", label: "Funded", state: "upcoming" },
        { key: "DELIVERED", label: "Delivered", state: "upcoming" },
        { key: "RELEASED", label: "Released", state: "upcoming" },
      ];
    case "FUNDED":
      return [
        { key: "CREATED", label: "Created", state: "completed" },
        { key: "FUNDED", label: "Funded", state: "active" },
        { key: "DELIVERED", label: "Delivered", state: "upcoming" },
        { key: "RELEASED", label: "Released", state: "upcoming" },
      ];
    case "DELIVERED":
      return [
        { key: "CREATED", label: "Created", state: "completed" },
        { key: "FUNDED", label: "Funded", state: "completed" },
        { key: "DELIVERED", label: "Delivered", state: "active" },
        { key: "RELEASED", label: "Released", state: "upcoming" },
      ];
    case "RELEASED":
      return [
        { key: "CREATED", label: "Created", state: "completed" },
        { key: "FUNDED", label: "Funded", state: "completed" },
        { key: "DELIVERED", label: "Delivered", state: "completed" },
        { key: "RELEASED", label: "Released", state: "completed" },
      ];
    case "DRAFT":
      return [
        { key: "CREATED", label: "Created", state: "upcoming" },
        { key: "FUNDED", label: "Funded", state: "upcoming" },
        { key: "DELIVERED", label: "Delivered", state: "upcoming" },
        { key: "RELEASED", label: "Released", state: "upcoming" },
      ];
    case "CANCELLED":
      return [
        { key: "CREATED", label: "Created", state: "completed" },
        { key: "CANCELLED", label: "Cancelled", state: "completed" },
      ];
    case "REFUNDED":
      return [
        { key: "CREATED", label: "Created", state: "completed" },
        { key: "FUNDED", label: "Funded", state: "completed" },
        {
          key: deliveredAt ? "DELIVERED" : "REFUNDING",
          label: deliveredAt ? "Delivered" : "Reclaimed",
          state: "completed",
        },
        { key: "REFUNDED", label: "Refunded", state: "completed" },
      ];
    case "DISPUTED":
      return deliveredAt
        ? [
            { key: "CREATED", label: "Created", state: "completed" },
            { key: "FUNDED", label: "Funded", state: "completed" },
            { key: "DELIVERED", label: "Delivered", state: "completed" },
            { key: "DISPUTED", label: "Disputed", state: "active" },
          ]
        : [
            { key: "CREATED", label: "Created", state: "completed" },
            { key: "FUNDED", label: "Funded", state: "completed" },
            { key: "DISPUTED", label: "Disputed", state: "active" },
            { key: "RESOLVED", label: "Resolved", state: "upcoming" },
          ];
    case "RESOLVED":
      return deliveredAt
        ? [
            { key: "CREATED", label: "Created", state: "completed" },
            { key: "FUNDED", label: "Funded", state: "completed" },
            { key: "DELIVERED", label: "Delivered", state: "completed" },
            { key: "RESOLVED", label: "Resolved", state: "completed" },
          ]
        : [
            { key: "CREATED", label: "Created", state: "completed" },
            { key: "FUNDED", label: "Funded", state: "completed" },
            { key: "DISPUTED", label: "Disputed", state: "completed" },
            { key: "RESOLVED", label: "Resolved", state: "completed" },
          ];
  }
}

export function DealLifecycleStepper({
  status,
  deliveredAt,
}: {
  readonly status: DealStatus;
  readonly deliveredAt?: string | null;
}) {
  const stages = resolveStages(status, deliveredAt);
  const branch = getBranchBanner(status);

  return (
    <div className="space-y-3">
      <ol
        aria-label="Escrow lifecycle progress"
        className={`grid gap-2 grid-cols-2 ${stages.length <= 2 ? "sm:grid-cols-2" : "sm:grid-cols-4"}`}
      >
        {stages.map((stage, index) => {
          const state = stage.state;
          const isCurrent =
            state === "active" ||
            ((status === "RELEASED" || status === "RESOLVED") && index === stages.length - 1);

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
