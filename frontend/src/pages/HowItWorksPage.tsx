import { Link } from "react-router-dom";
import { ShieldAlert, ArrowRight, Lock, CheckCircle2, Scale } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Panel } from "@/components/ui/Primitives";
import { ROUTES } from "@/config/routes";

const LIFECYCLE_STEPS = [
  {
    step: "01",
    title: "Seller creates terms & locks trade hash",
    body: "The seller drafts deal terms, deadlines, and an arbiter address. SafeDeal computes a deterministic RFC 8785 SHA-256 hash and binds it on-chain via createTrade.",
    tags: ["createTrade"],
    icon: Lock,
  },
  {
    step: "02",
    title: "Buyer verifies terms & funds escrow",
    body: "The buyer inspects the exact terms hash, confirms the escrow amount in native AVAX, and submits fundTrade. Funds stay locked in the SafeDealEscrow contract.",
    tags: ["fundTrade"],
    icon: CheckCircle2,
  },
  {
    step: "03",
    title: "Delivery, approval, or arbitration",
    body: "After markDelivered, the buyer calls releaseFunds to credit the seller. If an agreement fails before delivery deadline, buyer can reclaim; if disputed, the assigned arbiter settles the split.",
    tags: ["markDelivered", "releaseFunds", "resolveDispute"],
    icon: Scale,
  },
] as const;

export function HowItWorksPage() {
  return (
    <AppShell
      title="How SafeDeal Works"
      subtitle="Transparent native-AVAX escrow lifecycle, pull-payment safety, and explicit trust boundaries."
    >
      <div className="grid gap-8 lg:grid-cols-12">
        <Panel className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between border-b border-sd-line pb-4">
            <h2 className="text-base font-medium text-white">Protocol Lifecycle Rail</h2>
            <span className="font-mono text-xs text-sd-inkSubtle">3 deterministic stages</span>
          </div>

          <ol className="relative space-y-8 pl-9 before:absolute before:bottom-3 before:left-3.5 before:top-3 before:w-px before:bg-sd-lineStrong">
            {LIFECYCLE_STEPS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.step} className="relative space-y-2.5">
                  <span
                    aria-hidden="true"
                    className="absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-sd-lineStrong bg-sd-elevated font-mono text-[11px] font-medium text-sd-accent"
                  >
                    {item.step}
                  </span>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-sd-inkSubtle">STAGE {item.step}</span>
                      <h3 className="text-base font-medium text-white">{item.title}</h3>
                    </div>
                    <Icon size={16} className="text-sd-inkMuted shrink-0" aria-hidden="true" />
                  </div>

                  <p className="max-w-[65ch] text-sm leading-relaxed text-sd-inkMuted">{item.body}</p>

                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {item.tags.map((tag) => (
                      <code
                        key={tag}
                        className="rounded-md border border-sd-line bg-sd-inset px-2 py-0.5 font-mono text-[11px] text-sd-ink"
                      >
                        {tag}
                      </code>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="lg:col-span-5 space-y-6">
          <Panel variant="elevated" className="space-y-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-sd-accent">
              Settlement Safety
            </p>
            <h2 className="text-lg font-medium text-white">Pull-Payment Settlement Architecture</h2>
            <p className="max-w-[65ch] text-sm leading-relaxed text-sd-inkMuted">
              SafeDeal separates escrow settlement from fund transfer. When a trade is released, refunded, or
              resolved by an arbiter, the contract updates claimable balances on-chain without pushing AVAX
              inline. Each beneficiary then invokes{" "}
              <code className="rounded bg-sd-inset px-1.5 py-0.5 font-mono text-xs text-white">withdraw()</code>{" "}
              independently, preventing a reverting recipient contract from blocking settlement or counterparty funds.
            </p>
          </Panel>

          <Panel variant="inset" className="border-amber-400/35 bg-amber-500/[0.06] space-y-3">
            <div className="flex items-center gap-2 text-amber-200">
              <ShieldAlert size={18} aria-hidden="true" />
              <h2 className="text-base font-medium">Important Trust Limitation</h2>
            </div>
            <p className="max-w-[65ch] text-sm leading-relaxed text-sd-inkMuted">
              SafeDeal does not verify real-world service delivery autonomously. While the smart contract
              strictly enforces custody, deadlines, and non-custodial settlement rules, a designated human
              arbiter remains a trusted party for disputed transactions. If an arbiter becomes permanently
              unavailable while a deal is disputed, disputed funds remain locked on-chain until resolved.
            </p>
          </Panel>

          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              to={ROUTES.create}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-[#09090b] transition-colors hover:bg-white/90"
            >
              <span>Create a Deal</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link
              to={ROUTES.dashboard}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-sd-lineStrong bg-sd-elevated/70 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-sd-elevated"
            >
              Open My Deals
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
