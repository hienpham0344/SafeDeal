import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { disputePath, ROUTES } from "@/config/routes";
import { useAssignedDisputesQuery } from "@/features/arbitration/hooks/useArbitration";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { DisputeConsensusPanel } from "@/features/disputes/components/DisputeConsensusPanel";
import type { DisputeDetail } from "@/types/api";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

function ArbiterDisputeCard({ dispute }: { readonly dispute: DisputeDetail }) {
  return (
    <Panel className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sd-line pb-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-medium text-white">
            Dispute #{dispute.id} · {dispute.dealTitle}
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-sd-inkSubtle tabular-nums">
            <span>Trade</span>
            <CopyableHash
              value={dispute.tradeId}
              displayValue={shortenAddress(dispute.tradeId, 6)}
              label="Trade ID"
              className="text-xs"
            />
            <span>· Locked: {formatAvax(dispute.dealAmountWei)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={dispute.status} />
          <Link
            to={disputePath(String(dispute.id))}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-sd-lineStrong bg-sd-elevated/70 px-3 py-1.5 text-xs font-medium text-sd-ink transition-colors hover:border-white/30 hover:bg-sd-elevated"
          >
            <span>Inspect Evidence</span>
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-sd-inkMuted">{dispute.summary}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sd-line bg-sd-inset px-3.5 py-2 text-xs text-sd-inkSubtle">
        <span>
          Buyer: <span className="font-mono text-sd-inkMuted">{shortenAddress(dispute.buyer)}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Seller: <span className="font-mono text-sd-inkMuted">{shortenAddress(dispute.seller)}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">Opened {formatTimestamp(dispute.createdAt)}</span>
      </div>

      <DisputeConsensusPanel dispute={dispute} variant="embedded" />
    </Panel>
  );
}

export function ArbiterPage() {
  const { isConnected, isAuthenticated, openWalletModal, signInWithWallet } = useAuthSession();
  const disputesQuery = useAssignedDisputesQuery(isAuthenticated);

  return (
    <AppShell
      breadcrumb={{ label: "My Deals", to: ROUTES.dashboard }}
      title="Arbiter Dashboard"
      subtitle="Disputes assigned to your connected wallet. Settlement requires 2-of-3 consensus across Buyer, Seller, and Arbiter."
    >
      {!isConnected ? (
        <EmptyState
          title="Connect arbiter wallet"
          description="Connect the designated arbiter wallet to review evidence and submit 2-of-3 settlement votes."
          action={<Button onClick={openWalletModal}>Connect Wallet</Button>}
        />
      ) : !isAuthenticated ? (
        <EmptyState
          title="Sign in as arbiter"
          description="Verify wallet ownership via SIWE to load disputes assigned to your address."
          action={<Button onClick={() => void signInWithWallet()}>Sign In with Wallet</Button>}
        />
      ) : disputesQuery.isLoading ? (
        <LoadingState label="Loading assigned disputes..." />
      ) : disputesQuery.isError ? (
        <AlertBanner
          tone="error"
          title="Unable to load disputes"
          message={disputesQuery.error instanceof Error ? disputesQuery.error.message : "Failed to fetch disputes."}
        />
      ) : !disputesQuery.data || disputesQuery.data.length === 0 ? (
        <EmptyState
          title="No assigned disputes"
          description="There are no escrow disputes assigned to your connected wallet address."
        />
      ) : (
        <div className="space-y-4">
          {disputesQuery.data.map((dispute) => (
            <ArbiterDisputeCard key={dispute.id} dispute={dispute} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
