import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { dealPath, ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { DASHBOARD_TABS, filterDealsForTab, type DashboardTab } from "@/features/deals/deal-filters";
import { useDealsQuery } from "@/features/deals/hooks/useDeals";
import { useClaimableBalance, useEscrowContractExecutor } from "@/features/escrow/hooks/useEscrowActions";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

const ACTIVE_ESCROW_STATUSES = new Set(["FUNDED", "DELIVERED", "DISPUTED"]);

function parseSafeWei(wei: string): bigint {
  try {
    return BigInt(wei);
  } catch {
    return 0n;
  }
}

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

  const summaryMetrics = useMemo(() => {
    const items = dealsQuery.data?.items ?? [];
    let activeEscrowWei = 0n;
    let disputedCount = 0;

    for (const deal of items) {
      if (ACTIVE_ESCROW_STATUSES.has(deal.status)) {
        activeEscrowWei += parseSafeWei(deal.amountWei);
      }
      if (deal.status === "DISPUTED") {
        disputedCount += 1;
      }
    }

    return {
      totalDeals: dealsQuery.data?.totalItems ?? items.length,
      activeEscrowWei,
      disputedCount,
    };
  }, [dealsQuery.data?.items, dealsQuery.data?.totalItems]);

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
      {isAuthenticated && !dealsQuery.isLoading && !dealsQuery.isError && dealsQuery.data && (
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Ledger summary">
          <div className="rounded-xl border border-sd-line bg-sd-surface px-4 py-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
            <p className="text-[11px] font-medium uppercase tracking-wider text-sd-inkSubtle">Total Deals</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
              {summaryMetrics.totalDeals}
            </p>
          </div>
          <div className="rounded-xl border border-sd-line bg-sd-surface px-4 py-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
            <p className="text-[11px] font-medium uppercase tracking-wider text-sd-inkSubtle">Active Escrow</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
              {formatAvax(summaryMetrics.activeEscrowWei)}
            </p>
          </div>
          <div className="rounded-xl border border-sd-line bg-sd-surface px-4 py-3.5 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]">
            <p className="text-[11px] font-medium uppercase tracking-wider text-sd-inkSubtle">
              Attention Required
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <p
                className={`font-mono text-2xl font-semibold tabular-nums ${
                  summaryMetrics.disputedCount > 0 ? "text-red-300" : "text-white"
                }`}
              >
                {summaryMetrics.disputedCount}
              </p>
              {claimableWei > 0n && (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-200">
                  + Claimable
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sd-line">
        <div
          className="-mb-px flex flex-wrap items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Deal filters"
        >
          {DASHBOARD_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[44px] sm:min-h-[38px] items-center border-b-2 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sd-canvas ${
                activeTab === tab.id
                  ? "border-sd-accent text-white"
                  : "border-transparent text-sd-inkMuted hover:border-sd-lineStrong hover:text-sd-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Link
          to={ROUTES.create}
          className="mb-2 inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-medium text-[#09090b] shadow-[0_1px_0_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-white/90"
        >
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
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
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#09090b] hover:bg-white/90"
            >
              Create a Deal
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredDeals.map((deal) => (
            <Link key={deal.tradeId} to={dealPath(deal.tradeId)} className="block group">
              <Panel className="p-5 transition-colors hover:border-sd-lineStrong group-hover:bg-sd-elevated/60">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="truncate text-base font-medium text-white transition-colors group-hover:text-emerald-200">
                        {deal.title}
                      </h2>
                      <span className="font-mono text-xs text-sd-inkSubtle">
                        {shortenAddress(deal.tradeId, 6)}
                      </span>
                    </div>

                    <p className="line-clamp-1 text-sm text-sd-inkMuted">{deal.description}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
                      <span className="text-sd-inkSubtle">
                        Seller:{" "}
                        <span className="font-mono text-sd-inkMuted">{shortenAddress(deal.seller)}</span>
                      </span>
                      <span className="text-sd-inkSubtle">
                        Buyer:{" "}
                        <span className="font-mono text-sd-inkMuted">{shortenAddress(deal.buyer)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-sd-line pt-3 md:shrink-0 md:justify-end md:border-t-0 md:pt-0">
                    <div className="text-left md:text-right">
                      <p className="font-mono text-sm font-semibold tabular-nums text-white">
                        {formatAvax(deal.amountWei)}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-sd-inkMuted">
                        Due {formatTimestamp(deal.deliveryDeadline)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <StatusBadge status={deal.status} />
                      <ChevronRight
                        size={16}
                        strokeWidth={1.75}
                        aria-hidden="true"
                        className="text-sd-inkSubtle transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                      />
                    </div>
                  </div>
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
