import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { Panel } from "@/components/ui/Primitives";
import { appConfig } from "@/config/app.config";
import { env } from "@/config/env";
import { getExplorerAddressUrl } from "@/config/network.config";
import { apiRequest } from "@/services/http/api-client";
import type { HealthStatusResponse } from "@/types/api";
import { shortenAddress } from "@/utils/format";

const DISPUTE_TIMEOUT_DAYS = Math.round(appConfig.escrow.disputeTimeoutSeconds / 86_400);

export function SupportPage() {
  const healthQuery = useQuery({
    queryKey: ["system", "health"],
    queryFn: () => apiRequest<HealthStatusResponse>("/api/v1/health"),
    retry: false,
  });

  const contractExplorerUrl = env.escrowContractAddress
    ? getExplorerAddressUrl(env.escrowContractAddress)
    : null;

  return (
    <AppShell
      title="Support & Network Status"
      subtitle="Verify the active network and escrow contract, check service health, and find answers to common questions."
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <Panel variant="elevated" className="lg:col-span-5 h-fit space-y-4">
          <div className="flex items-center justify-between border-b border-sd-line pb-3">
            <h2 className="text-base font-medium text-white">Network &amp; Contract</h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
              Live Status
            </span>
          </div>

          <dl className="divide-y divide-sd-line text-sm">
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt className="text-sd-inkMuted">Network</dt>
              <dd className="font-mono text-xs text-white tabular-nums text-right">
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
              <dd className="font-mono text-xs text-white text-right">Non-custodial (Pull-payment)</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <dt className="text-sd-inkMuted">Backend API</dt>
              <dd>
                {healthQuery.isLoading ? (
                  <span className="font-mono text-xs text-sd-inkSubtle">Checking...</span>
                ) : healthQuery.isError || !healthQuery.data ? (
                  <span className="font-mono text-xs text-red-300">Unavailable</span>
                ) : healthQuery.data.status !== "UP" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-0.5 font-mono text-xs text-red-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
                    Degraded ({healthQuery.data.status})
                  </span>
                ) : !healthQuery.data.escrowContractConfigured ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-xs text-amber-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                    Degraded (Contract Unconfigured)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-xs text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    Operational
                  </span>
                )}
              </dd>
            </div>
            {env.chainId === 43113 && (
              <div className="flex items-center justify-between gap-4 pt-3">
                <dt className="text-sd-inkMuted">Testnet Faucet</dt>
                <dd className="text-right">
                  <a
                    href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-sd-accent hover:underline"
                  >
                    <span>Get Fuji AVAX</span>
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </Panel>

        <Panel className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between border-b border-sd-line pb-3">
            <h2 className="text-base font-medium text-white">Frequently Asked Questions</h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
              Help &amp; Guide
            </span>
          </div>

          <div className="divide-y divide-sd-line text-sm text-sd-inkMuted">
            <div className="pb-4">
              <h3 className="font-medium text-white">Why do I have to sign a message after connecting my wallet?</h3>
              <p className="mt-1.5 leading-relaxed">
                Signing the Sign-In with Ethereum (EIP-4361) message verifies wallet ownership without spending
                any gas. This ensures off-chain deal drafts and private dispute evidence are accessible only to
                authorized participants.
              </p>
            </div>
            <div className="py-4">
              <h3 className="font-medium text-white">Where do settled funds go?</h3>
              <p className="mt-1.5 leading-relaxed">
                SafeDeal uses a pull-payment model—settled {appConfig.escrow.nativeSymbol} is credited to your
                on-chain claimable balance rather than pushed automatically. Open{" "}
                <strong className="font-medium text-white">My Deals</strong> and click{" "}
                <strong className="font-medium text-white">Withdraw Balance</strong> (or{" "}
                <strong className="font-medium text-white">Withdraw {appConfig.escrow.nativeSymbol}</strong> on
                the deal page) to transfer funds to your wallet.
              </p>
            </div>
            <div className="py-4">
              <h3 className="font-medium text-white">What if my browser refreshes during a transaction?</h3>
              <p className="mt-1.5 leading-relaxed">
                Pending transaction hashes are saved per session and reconciled automatically once confirmed
                on-chain. If a deal status looks behind, open the deal page and click{" "}
                <strong className="font-medium text-white">Sync On-Chain</strong>.
              </p>
            </div>
            <div className="py-4">
              <h3 className="font-medium text-white">How are disputes resolved if participants disagree?</h3>
              <p className="mt-1.5 leading-relaxed">
                Funded or delivered deals can enter a dispute where Buyer, Seller, and the neutral Arbiter review
                evidence and vote on the payout split. Settlement executes once any 2 of 3 participants reach
                matching votes—or anyone can trigger the 50/50 timeout fallback after {DISPUTE_TIMEOUT_DAYS} days
                so funds never stay locked.
              </p>
            </div>
            <div className="pt-4">
              <h3 className="font-medium text-white">What should I check if a transaction won&apos;t send?</h3>
              <p className="mt-1.5 leading-relaxed">
                Confirm your wallet is switched to{" "}
                <strong className="font-medium text-white">
                  {env.chainName} ({env.chainId})
                </strong>
                , you hold enough {appConfig.escrow.nativeSymbol} for both the escrow amount and network gas, and
                the Backend API status indicator on the left is healthy.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
