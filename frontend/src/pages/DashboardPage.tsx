import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { dealPath, ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { DASHBOARD_TABS, filterDealsForTab, type DashboardTab } from "@/features/deals/deal-filters";
import { useDealsQuery } from "@/features/deals/hooks/useDeals";
import { useClaimableBalance, useEscrowContractExecutor } from "@/features/escrow/hooks/useEscrowActions";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("ALL");
  const { address, isConnected, isAuthenticated, openWalletModal, signInWithWallet } = useAuthSession();
  const dealsQuery = useDealsQuery({ page: 0, size: 50 }, isAuthenticated);
  const claimableQuery = useClaimableBalance(address);
  const { withdraw, activeAction, txError } = useEscrowContractExecutor();
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  const filteredDeals = useMemo(
    () => filterDealsForTab(dealsQuery.data?.items ?? [], activeTab, address),
    [activeTab, address, dealsQuery.data?.items]
  );

  const claimableWei = claimableQuery.data ?? 0n;

  async function handleWithdrawAll() {
    setWithdrawSuccess(null);
    try {
      const result = await withdraw();
      setWithdrawSuccess(`Withdrawal confirmed in tx ${result.txHash}`);
      await claimableQuery.refetch();
    } catch {
      // Wallet and transaction errors are captured in executor.txError banner
    }
  }

  return (
    <AppShell
      title="My Deals"
      subtitle="Monitor escrow lifecycles, claimable settlement balances, and active transactions."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Deal filters">
          {DASHBOARD_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-black"
                  : "border border-white/15 text-white/75 hover:border-white/40 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Link
          to={ROUTES.create}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
        >
          <Plus size={16} />
          <span>New Deal</span>
        </Link>
      </div>

      {claimableWei > 0n && (
        <AlertBanner
          tone="success"
          title="Claimable AVAX Ready"
          message={`You have ${formatAvax(claimableWei)} ready to withdraw via pull-payment.`}
          action={
            <Button
              size="sm"
              disabled={activeAction === "withdraw"}
              onClick={() => void handleWithdrawAll()}
            >
              {activeAction === "withdraw" ? "Withdrawing..." : "Withdraw Balance"}
            </Button>
          }
        />
      )}

      {withdrawSuccess && <AlertBanner tone="success" message={withdrawSuccess} />}
      {txError && <AlertBanner tone="error" message={txError} />}

      {!isConnected ? (
        <EmptyState
          title="Connect your wallet"
          description="Connect an Avalanche-compatible wallet to view deals you created, funded, or arbitrate."
          action={<Button onClick={openWalletModal}>Connect Wallet</Button>}
        />
      ) : !isAuthenticated ? (
        <EmptyState
          title="Authenticate wallet session"
          description="Sign a one-time SIWE verification message so SafeDeal can load your private and participant deals."
          action={<Button onClick={() => void signInWithWallet()}>Sign In with Wallet</Button>}
        />
      ) : dealsQuery.isLoading ? (
        <LoadingState label="Loading your deals..." />
      ) : dealsQuery.isError ? (
        <AlertBanner
          tone="error"
          title="Unable to load deals"
          message={dealsQuery.error instanceof Error ? dealsQuery.error.message : "Failed to fetch deals."}
          action={
            <Button size="sm" variant="secondary" onClick={() => void dealsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : filteredDeals.length === 0 ? (
        <EmptyState
          title="No deals in this view"
          description="Create a new escrow deal or switch filters to see your transactions."
          action={
            <Link
              to={ROUTES.create}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
            >
              Create a Deal
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredDeals.map((deal) => (
            <Link key={deal.tradeId} to={dealPath(deal.tradeId)} className="block group">
              <Panel className="h-full space-y-4 transition-colors group-hover:border-white/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-white">{deal.title}</h2>
                    <p className="mt-1 font-mono text-xs text-white/45">{shortenAddress(deal.tradeId, 6)}</p>
                  </div>
                  <StatusBadge status={deal.status} />
                </div>

                <p className="line-clamp-2 text-sm text-white/65">{deal.description}</p>

                <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
                  <div>
                    <dt className="text-white/45">Escrow Amount</dt>
                    <dd className="mt-0.5 font-mono text-white">{formatAvax(deal.amountWei)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Delivery Deadline</dt>
                    <dd className="mt-0.5 text-white/80">{formatTimestamp(deal.deliveryDeadline)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Seller</dt>
                    <dd className="mt-0.5 font-mono text-white/80">{shortenAddress(deal.seller)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Buyer</dt>
                    <dd className="mt-0.5 font-mono text-white/80">{shortenAddress(deal.buyer)}</dd>
                  </div>
                </dl>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
