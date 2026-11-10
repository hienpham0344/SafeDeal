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
    icon: Lock,
  },
  {
    step: "02",
    title: "Buyer verifies terms & funds escrow",
    body: "The buyer inspects the exact terms hash, confirms the escrow amount in native AVAX, and submits fundTrade. Funds stay locked in the SafeDealEscrow contract.",
    icon: CheckCircle2,
  },
  {
    step: "03",
    title: "Delivery, approval, or arbitration",
    body: "After markDelivered, the buyer calls releaseFunds to credit the seller. If an agreement fails before delivery deadline, buyer can reclaim; if disputed, the assigned arbiter settles the split.",
    icon: Scale,
  },
] as const;

export function HowItWorksPage() {
  return (
    <AppShell
      title="How SafeDeal Works"
      subtitle="Transparent native-AVAX escrow lifecycle, pull-payment safety, and explicit trust boundaries."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {LIFECYCLE_STEPS.map((item) => {
          const Icon = item.icon;
          return (
            <Panel key={item.step} className="space-y-3">
              <div className="flex items-center justify-between text-white/50">
                <span className="font-mono text-xs">{item.step}</span>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h2 className="text-base font-medium text-white">{item.title}</h2>
              <p className="text-sm leading-relaxed text-white/65">{item.body}</p>
            </Panel>
          );
        })}
      </div>

      <Panel className="space-y-4">
        <h2 className="text-lg font-medium text-white">Pull-Payment Settlement Architecture</h2>
        <p className="text-sm leading-relaxed text-white/65">
          SafeDeal separates escrow settlement from fund transfer. When a trade is released, refunded, or
          resolved by an arbiter, the contract updates claimable balances on-chain without pushing AVAX
          inline. Each beneficiary then invokes <code className="text-white">withdraw()</code> independently,
          preventing a reverting recipient contract from blocking settlement or counterparty funds.
        </p>
      </Panel>

      <Panel className="border-amber-400/30 bg-amber-500/5 space-y-3">
        <div className="flex items-center gap-2 text-amber-200">
          <ShieldAlert size={18} aria-hidden="true" />
          <h2 className="text-base font-medium">Important Trust Limitation</h2>
        </div>
        <p className="text-sm leading-relaxed text-white/75">
          SafeDeal does not verify real-world service delivery autonomously. While the smart contract
          strictly enforces custody, deadlines, and non-custodial settlement rules, a designated human
          arbiter remains a trusted party for disputed transactions. If an arbiter becomes permanently
          unavailable while a deal is disputed, disputed funds remain locked on-chain until resolved.
        </p>
      </Panel>

      <div className="flex flex-wrap gap-3">
        <Link
          to={ROUTES.create}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-white/90"
        >
          <span>Create a Deal</span>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link
          to={ROUTES.dashboard}
          className="inline-flex items-center rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/5"
        >
          Open My Deals
        </Link>
      </div>
    </AppShell>
  );
}
