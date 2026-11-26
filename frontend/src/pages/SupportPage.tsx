import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  HelpCircle,
  KeyRound,
  Layers,
  RefreshCw,
  Scale,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { Panel } from "@/components/ui/Primitives";
import { appConfig } from "@/config/app.config";
import { env } from "@/config/env";
import { getExplorerAddressUrl } from "@/config/network.config";
import { ROUTES } from "@/config/routes";
import { apiRequest } from "@/services/http/api-client";
import type { HealthStatusResponse } from "@/types/api";
import { shortenAddress } from "@/utils/format";

const DISPUTE_TIMEOUT_DAYS = Math.round(appConfig.escrow.disputeTimeoutSeconds / 86_400);
const MAX_EVIDENCE_MB = Math.round(env.maxEvidenceBytes / (1024 * 1024));

type FaqCategory = "ALL" | "AUTH" | "SETTLEMENT" | "DISPUTES" | "RECOVERY";

const FAQ_CATEGORIES: readonly { readonly id: FaqCategory; readonly label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "AUTH", label: "SIWE Auth" },
  { id: "SETTLEMENT", label: "Pull-Payment" },
  { id: "DISPUTES", label: "2-of-3 Disputes" },
  { id: "RECOVERY", label: "Sync & Recovery" },
];

export function SupportPage() {
  const [selectedCategory, setSelectedCategory] = useState<FaqCategory>("ALL");

  const healthQuery = useQuery({
    queryKey: ["system", "health"],
    queryFn: () => apiRequest<HealthStatusResponse>("/api/v1/health"),
    retry: false,
  });

  const contractExplorerUrl = env.escrowContractAddress
    ? getExplorerAddressUrl(env.escrowContractAddress)
    : null;

  const networkEnvironmentLabel =
    env.chainId === 43113
      ? "Avalanche Testnet"
      : env.chainId === 43114
        ? "Avalanche Mainnet"
        : "Local Devnet";

  const faqItems = [
    {
      number: "01",
      category: "AUTH" as const,
      badge: "SIWE • EIP-4361",
      icon: KeyRound,
      question: "Why do I have to sign a message after connecting my wallet?",
      answer: (
        <>
          Signing the Sign-In with Ethereum (EIP-4361) message verifies wallet ownership cryptographically
          without spending any gas. This ensures off-chain deal drafts and private dispute evidence remain
          accessible strictly to authorized deal participants.
        </>
      ),
    },
    {
      number: "02",
      category: "SETTLEMENT" as const,
      badge: "PULL-PAYMENT VAULT",
      icon: Wallet,
      question: "Where do settled funds go?",
      answer: (
        <>
          SafeDeal uses a pull-payment model—settled {appConfig.escrow.nativeSymbol} is credited to your
          on-chain claimable balance rather than pushed inline. Open{" "}
          <code className="rounded border border-sd-line bg-sd-elevated px-1.5 py-0.5 font-mono text-xs text-white">
            My Deals
          </code>{" "}
          and click{" "}
          <code className="rounded border border-sd-line bg-sd-elevated px-1.5 py-0.5 font-mono text-xs text-white">
            Withdraw Balance
          </code>{" "}
          (or{" "}
          <code className="rounded border border-sd-line bg-sd-elevated px-1.5 py-0.5 font-mono text-xs text-white">
            Withdraw {appConfig.escrow.nativeSymbol}
          </code>{" "}
          on the deal page) to transfer funds to your wallet.
        </>
      ),
    },
    {
      number: "03",
      category: "RECOVERY" as const,
      badge: "RELOAD-SAFE SYNC",
      icon: RefreshCw,
      question: "What if my browser refreshes during a transaction?",
      answer: (
        <>
          Pending transaction hashes are persisted per session and reconciled automatically once confirmed
          on-chain. If a deal status looks behind after a network drop, open the deal page and click{" "}
          <code className="rounded border border-sd-line bg-sd-elevated px-1.5 py-0.5 font-mono text-xs text-white">
            Sync On-Chain
          </code>
          .
        </>
      ),
    },
    {
      number: "04",
      category: "DISPUTES" as const,
      badge: "2-OF-3 CONSENSUS",
      icon: Scale,
      question: "How are disputes resolved if participants disagree?",
      answer: (
        <>
          Funded or delivered deals can enter a dispute where Buyer, Seller, and the neutral Arbiter review
          magic-byte verified evidence and vote on the payout split. Settlement executes as soon as any{" "}
          <strong className="font-medium text-white">2 of 3 participants</strong> submit matching votes—or
          anyone can trigger the deterministic{" "}
          <strong className="font-medium text-white">50/50 timeout fallback</strong> after{" "}
          {DISPUTE_TIMEOUT_DAYS} days so funds never stay locked.
        </>
      ),
    },
    {
      number: "05",
      category: "RECOVERY" as const,
      badge: "PRE-FLIGHT CHECK",
      icon: HelpCircle,
      question: "What should I check if a transaction won't send?",
      answer: (
        <>
          Confirm your wallet is switched to{" "}
          <strong className="font-medium text-white">
            {env.chainName} ({env.chainId})
          </strong>
          , you hold enough {appConfig.escrow.nativeSymbol} for both the escrow amount and network gas, and
          the Backend API status indicator on the left is healthy.
        </>
      ),
    },
  ];

  const visibleFaqs =
    selectedCategory === "ALL"
      ? faqItems
      : faqItems.filter((item) => item.category === selectedCategory);

  function renderHealthBadge() {
    if (healthQuery.isLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sd-lineStrong bg-sd-inset px-3 py-1 font-mono text-xs text-sd-inkSubtle">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" aria-hidden="true" />
          Checking...
        </span>
      );
    }
    if (healthQuery.isError || !healthQuery.data) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/35 bg-red-500/10 px-3 py-1 font-mono text-xs text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
          Unavailable
        </span>
      );
    }
    if (healthQuery.data.status !== "UP") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/35 bg-red-500/10 px-3 py-1 font-mono text-xs text-red-200">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
          Degraded ({healthQuery.data.status})
        </span>
      );
    }
    if (!healthQuery.data.escrowContractConfigured) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-500/10 px-3 py-1 font-mono text-xs text-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
          Degraded (Contract Unconfigured)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        Operational
      </span>
    );
  }

  return (
    <AppShell
      title="Support & Network Status"
      subtitle="Verify live Avalanche C-Chain escrow telemetry, inspect protocol security invariants, and troubleshoot wallet or transaction flows."
    >
      <div className="space-y-6">
        {/* Top Telemetry Summary Strip */}
        <div className="grid gap-4 md:grid-cols-3">
          <Panel variant="elevated" className="flex flex-col justify-between gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                <Activity size={14} className="text-sd-accent" aria-hidden="true" />
                Backend API &amp; Indexer
              </span>
              <button
                type="button"
                onClick={() => void healthQuery.refetch()}
                disabled={healthQuery.isFetching}
                aria-label="Refresh backend status"
                title="Refresh backend status"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sd-line bg-sd-inset text-sd-inkMuted transition-colors hover:border-sd-lineStrong hover:text-white disabled:opacity-50"
              >
                <RefreshCw
                  size={13}
                  className={healthQuery.isFetching ? "animate-spin" : ""}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {healthQuery.data?.service ?? "safedeal-api"}
                </p>
                <p className="font-mono text-xs text-sd-inkMuted">SIWE + Event Indexer</p>
              </div>
              {renderHealthBadge()}
            </div>
          </Panel>

          <Panel variant="elevated" className="flex flex-col justify-between gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                <Layers size={14} className="text-sd-accent" aria-hidden="true" />
                Target EVM Network
              </span>
              <span className="shrink-0 whitespace-nowrap rounded-full border border-sd-line bg-sd-inset px-2.5 py-0.5 font-mono text-[11px] text-sd-inkMuted">
                {networkEnvironmentLabel}
              </span>
            </div>
            <div>
              <p className="font-mono text-sm font-medium text-white tabular-nums">
                {env.chainName} ({env.chainId})
              </p>
              <p className="font-mono text-xs text-sd-accent">
                Native {appConfig.escrow.nativeSymbol} Settlement
              </p>
            </div>
          </Panel>

          <Panel variant="elevated" className="flex flex-col justify-between gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                <ShieldCheck size={14} className="text-sd-accent" aria-hidden="true" />
                Escrow Custody Model
              </span>
              <span className="shrink-0 whitespace-nowrap rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] text-emerald-200">
                Zero Admin Keys
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-white">Non-custodial (Pull-payment)</p>
              <p className="font-mono text-xs text-sd-inkMuted">
                2-of-3 Consensus • {DISPUTE_TIMEOUT_DAYS}d Fallback
              </p>
            </div>
          </Panel>
        </div>

        {/* Main Two-Column Grid */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column: Contract Telemetry + Self-Service Diagnostic Checklist */}
          <div className="space-y-6 lg:col-span-5">
            <Panel variant="elevated" className="space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-sd-line pb-3.5">
                <div>
                  <h2 className="text-base font-medium text-white">Network &amp; Contract</h2>
                  <p className="mt-0.5 text-xs text-sd-inkMuted">
                    On-chain runtime parameters and verified contract binding
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-md border border-sd-line bg-sd-inset px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-sd-inkSubtle">
                  Live Status
                </span>
              </div>

              <dl className="divide-y divide-sd-line text-sm">
                <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                  <dt className="text-sd-inkMuted">Network</dt>
                  <dd className="text-right font-mono text-xs text-white tabular-nums">
                    {env.chainName} ({env.chainId})
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="shrink-0 text-sd-inkMuted">Escrow Contract</dt>
                  <dd className="min-w-0 text-right">
                    {env.escrowContractAddress ? (
                      <div className="inline-flex items-center justify-end gap-1">
                        <CopyableHash
                          value={env.escrowContractAddress}
                          displayValue={shortenAddress(env.escrowContractAddress, 6)}
                          label="Escrow Contract"
                          className="text-xs"
                        />
                        {contractExplorerUrl ? (
                          <a
                            href={contractExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View escrow contract on block explorer"
                            title="View on block explorer"
                            className="inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-md p-1.5 text-sd-inkMuted transition-colors hover:bg-white/10 hover:text-sd-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-canvas"
                          >
                            <ExternalLink size={14} aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-sd-inkSubtle">Not configured</span>
                    )}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-sd-inkMuted">Escrow Model</dt>
                  <dd className="text-right font-mono text-xs text-white">
                    Non-custodial (Pull-payment)
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-sd-inkMuted">Terms Integrity</dt>
                  <dd className="text-right font-mono text-xs text-white">RFC 8785 + SHA-256</dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-sd-inkMuted">Dispute Resolution</dt>
                  <dd className="text-right font-mono text-xs text-white">
                    2-of-3 Vote ({DISPUTE_TIMEOUT_DAYS}d 50/50 Timeout)
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                  <dt className="text-sd-inkMuted">Evidence Guard</dt>
                  <dd className="text-right font-mono text-xs text-white">
                    Magic-Byte Checked (≤ {MAX_EVIDENCE_MB} MB)
                  </dd>
                </div>
              </dl>

              {(env.chainId === 43113 || contractExplorerUrl) && (
                <div className="flex flex-wrap items-center gap-2.5 border-t border-sd-line pt-4">
                  {env.chainId === 43113 && (
                    <a
                      href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-sd-accent/40 bg-sd-accent/10 px-3.5 py-2 font-mono text-xs font-medium text-sd-accent transition-colors hover:bg-sd-accent/15"
                    >
                      <span>Get Fuji AVAX</span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  )}
                  {contractExplorerUrl && (
                    <a
                      href={contractExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-sd-lineStrong bg-sd-inset px-3.5 py-2 font-mono text-xs font-medium text-white transition-colors hover:border-white/30 hover:bg-sd-surface"
                    >
                      <span>Snowtrace Explorer</span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  )}
                </div>
              )}
            </Panel>

            {/* Pre-Flight Checklist Card filling the left rail */}
            <Panel variant="inset" className="space-y-4 border-emerald-400/30 bg-emerald-500/[0.04]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-emerald-200">
                  <FileCheck2 size={17} aria-hidden="true" />
                  <h2 className="text-sm font-medium">Transaction Pre-Flight Checklist</h2>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300/80">
                  3 Checks
                </span>
              </div>

              <ul className="space-y-2.5 text-xs leading-relaxed text-sd-inkMuted">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    size={15}
                    className="mt-0.5 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-medium text-white">Wallet Chain Match:</strong> Connected
                    wallet must be on{" "}
                    <span className="font-mono text-white">
                      {env.chainName} ({env.chainId})
                    </span>
                    .
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    size={15}
                    className="mt-0.5 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-medium text-white">SIWE Session Active:</strong> Sign the
                    gasless EIP-4361 challenge so private deal drafts &amp; evidence routes authenticate.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2
                    size={15}
                    className="mt-0.5 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-medium text-white">Pull-Payment Claim:</strong> After release,
                    refund, or arbitration, claim your {appConfig.escrow.nativeSymbol} via{" "}
                    <span className="font-mono text-white">withdraw()</span> on My Deals.
                  </span>
                </li>
              </ul>

              <div className="flex flex-wrap items-center gap-2.5 border-t border-sd-line pt-3.5">
                <Link
                  to={ROUTES.howItWorks}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sd-lineStrong bg-sd-elevated px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-white/30"
                >
                  <span>How SafeDeal Works</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
                <Link
                  to={ROUTES.dashboard}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sd-line bg-sd-surface px-3 py-1.5 text-xs font-medium text-sd-inkMuted transition-colors hover:border-sd-lineStrong hover:text-white"
                >
                  <span>Open My Deals</span>
                </Link>
              </div>
            </Panel>
          </div>

          {/* Right Column: Structured FAQ Cards with Topic Filter */}
          <Panel className="space-y-5 lg:col-span-7">
            <div className="flex flex-col gap-3 border-b border-sd-line pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-medium text-white">Frequently Asked Questions</h2>
                <p className="mt-0.5 text-xs text-sd-inkMuted">
                  Protocol mechanics, pull-payment withdrawals, and dispute recovery
                </p>
              </div>
              <span className="w-fit shrink-0 whitespace-nowrap rounded-md border border-sd-line bg-sd-inset px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-sd-inkSubtle">
                Help &amp; Guide
              </span>
            </div>

            {/* Category Filter Bar */}
            <div
              role="tablist"
              aria-label="FAQ topic filter"
              className="flex flex-wrap items-center gap-1.5"
            >
              {FAQ_CATEGORIES.map((category) => {
                const isActive = selectedCategory === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setSelectedCategory(category.id)}
                    className={`whitespace-nowrap rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      isActive
                        ? "border-sd-accent/50 bg-sd-accent/15 text-white"
                        : "border-sd-line bg-sd-inset text-sd-inkMuted hover:border-sd-lineStrong hover:text-white"
                    }`}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>

            {/* Numbered FAQ Cards */}
            <div className="space-y-3">
              {visibleFaqs.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.number}
                    className="rounded-xl border border-sd-line bg-sd-inset/60 p-4 transition-colors hover:border-sd-lineStrong"
                  >
                    <div className="flex items-start gap-3.5">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sd-lineStrong bg-sd-elevated font-mono text-xs font-medium text-sd-accent"
                      >
                        {item.number}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                          <h3 className="text-sm font-medium text-white">{item.question}</h3>
                          <span className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded border border-sd-line bg-sd-surface px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sd-inkSubtle">
                            <Icon size={11} className="text-sd-accent" aria-hidden="true" />
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-sd-inkMuted">{item.answer}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Privacy & Non-Custodial Data Policy (#privacy-policy deep-link target for Chrome Web Store) */}
        <section id="privacy-policy" aria-labelledby="privacy-policy-heading" className="scroll-mt-24">
          <Panel variant="inset" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sd-line pb-3.5">
              <div>
                <h2 id="privacy-policy-heading" className="text-base font-medium text-white">
                  Privacy &amp; Non-Custodial Data Policy
                </h2>
                <p className="mt-0.5 text-xs text-sd-inkMuted">
                  Applies to the SafeDeal Web App and the SafeDeal Escrow Companion Chrome Extension
                </p>
              </div>
              <span className="shrink-0 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-emerald-200">
                Non-Custodial • Zero Tracking
              </span>
            </div>

            <div className="grid gap-4 text-xs leading-relaxed text-sd-inkMuted md:grid-cols-3">
              <div className="rounded-xl border border-sd-line bg-sd-surface/60 p-4 space-y-1.5">
                <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-white">
                  1. Zero Key Custody
                </p>
                <p>
                  SafeDeal never requests, accesses, transmits, or stores private keys or seed phrases. All
                  EIP-4361 SIWE authentication signatures and Avalanche escrow transactions are signed strictly inside
                  your wallet.
                </p>
              </div>

              <div className="rounded-xl border border-sd-line bg-sd-surface/60 p-4 space-y-1.5">
                <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-white">
                  2. Scoped Deal &amp; Evidence Data
                </p>
                <p>
                  Off-chain records store only wallet addresses, RFC 8785 canonical deal terms, and SHA-256 verified
                  dispute evidence restricted to deal participants and the assigned arbiter. Extension on-chain checks
                  query public RPC endpoints without ambient cookies.
                </p>
              </div>

              <div className="rounded-xl border border-sd-line bg-sd-surface/60 p-4 space-y-1.5">
                <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-white">
                  3. No Profiling or Data Sales
                </p>
                <p>
                  We do not embed advertising trackers, collect browsing history, or sell user data to third parties.
                  Watched trade IDs and draft selections in the browser extension remain stored locally on your device.
                </p>
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </AppShell>
  );
}
