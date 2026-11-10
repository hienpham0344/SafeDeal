import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Panel, StatusBadge } from "@/components/ui/Primitives";
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
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="space-y-4">
          <h2 className="text-base font-medium text-white">Runtime Configuration</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-white/55">Environment</dt>
              <dd className="font-mono text-white">{env.appEnv}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-white/55">Network</dt>
              <dd className="text-white">
                {env.chainName} ({env.chainId})
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
              <dt className="text-white/55">Escrow Contract</dt>
              <dd className="font-mono text-xs text-white break-all text-right">
                {env.escrowContractAddress ? (
                  contractExplorerUrl ? (
                    <a
                      href={contractExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline hover:text-white/80"
                    >
                      <span>{env.escrowContractAddress}</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    env.escrowContractAddress
                  )
                ) : (
                  "Not configured"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-white/55">Backend API</dt>
              <dd>
                {healthQuery.isLoading ? (
                  <span className="text-white/50">Checking...</span>
                ) : healthQuery.isError ? (
                  <span className="text-red-300">Unavailable</span>
                ) : (
                  <StatusBadge status="CREATED" />
                )}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="space-y-4">
          <h2 className="text-base font-medium text-white">Common Questions</h2>
          <div className="space-y-3 text-sm text-white/70">
            <div>
              <p className="font-medium text-white">Why do I have to sign in after connecting my wallet?</p>
              <p className="mt-1">
                SafeDeal uses EIP-4361 (SIWE) wallet signatures so off-chain deal drafts and private dispute
                evidence are accessible only to verified wallet participants.
              </p>
            </div>
            <div>
              <p className="font-medium text-white">Where do settled funds go?</p>
              <p className="mt-1">
                Settled AVAX is credited to your on-chain claimable balance. Visit My Deals or any settled
                deal page to withdraw via <code className="text-white">withdraw()</code>.
              </p>
            </div>
            <div>
              <p className="font-medium text-white">What if my browser refreshes during a transaction?</p>
              <p className="mt-1">
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
