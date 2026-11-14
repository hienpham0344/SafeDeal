import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Panel } from "@/components/ui/Primitives";
import { env } from "@/config/env";
import { getExplorerAddressUrl } from "@/config/network.config";
import { apiRequest } from "@/services/http/api-client";
import type { HealthStatusResponse } from "@/types/api";

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
      title="Support & Network Verification"
      subtitle="Runtime environment diagnostics, contract references, and operator guidance."
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <Panel variant="elevated" className="lg:col-span-5 h-fit space-y-4">
          <div className="flex items-center justify-between border-b border-sd-line pb-3">
            <h2 className="text-base font-medium text-white">Runtime Diagnostics</h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
              Live Telemetry
            </span>
          </div>

          <dl className="divide-y divide-sd-line text-sm">
            <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt className="text-sd-inkMuted">Environment</dt>
              <dd className="font-mono text-xs text-white">{env.appEnv}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sd-inkMuted">Network</dt>
              <dd className="font-mono text-xs text-white tabular-nums text-right">
                {env.chainName} ({env.chainId})
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="shrink-0 text-sd-inkMuted">Escrow Contract</dt>
              <dd className="font-mono text-xs text-white break-all text-right">
                {env.escrowContractAddress ? (
                  contractExplorerUrl ? (
                    <a
                      href={contractExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline decoration-sd-lineStrong underline-offset-4 transition-colors hover:text-sd-accent"
                    >
                      <span>{env.escrowContractAddress}</span>
                      <ExternalLink size={12} className="shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    env.escrowContractAddress
                  )
                ) : (
                  <span className="text-sd-inkSubtle">Not configured</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 pt-3">
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
          </dl>
        </Panel>

        <Panel className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between border-b border-sd-line pb-3">
            <h2 className="text-base font-medium text-white">Operator Reference & FAQ</h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
              Protocol Notes
            </span>
          </div>

          <div className="divide-y divide-sd-line text-sm text-sd-inkMuted">
            <div className="pb-4">
              <h3 className="font-medium text-white">Why do I have to sign in after connecting my wallet?</h3>
              <p className="mt-1.5 leading-relaxed">
                SafeDeal uses EIP-4361 (SIWE) wallet signatures so off-chain deal drafts and private dispute
                evidence are accessible only to verified wallet participants.
              </p>
            </div>
            <div className="py-4">
              <h3 className="font-medium text-white">Where do settled funds go?</h3>
              <p className="mt-1.5 leading-relaxed">
                Settled AVAX is credited to your on-chain claimable balance. Visit My Deals or any settled
                deal page to withdraw via{" "}
                <code className="rounded bg-sd-inset px-1.5 py-0.5 font-mono text-xs text-white">withdraw()</code>.
              </p>
            </div>
            <div className="pt-4">
              <h3 className="font-medium text-white">What if my browser refreshes during a transaction?</h3>
              <p className="mt-1.5 leading-relaxed">
                Pending transaction hashes are persisted per session and reconciled via the backend event
                indexer. You can also click Sync On-Chain State on any deal page.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
