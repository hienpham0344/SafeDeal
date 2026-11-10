import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { zeroAddress } from "viem";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/config/network.config";
import { disputePath } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import {
  useBindDealTxMutation,
  useDealHistoryQuery,
  useDealQuery,
  useSyncDealMutation,
} from "@/features/deals/hooks/useDeals";
import { usePendingTxPersistence } from "@/features/deals/hooks/usePendingTransactions";
import { useCreateDisputeMutation } from "@/features/disputes/hooks/useDisputes";
import {
  useClaimableBalance,
  useEscrowContractExecutor,
  useOnChainTrade,
} from "@/features/escrow/hooks/useEscrowActions";
import { computeCanonicalTermsHash } from "@/utils/canonical-terms";
import { formatAvax, formatDurationSeconds, formatTimestamp } from "@/utils/format";

const CHAIN_STATUS_NAMES = [
  "NONE",
  "CREATED",
  "FUNDED",
  "DELIVERED",
  "RELEASED",
  "REFUNDED",
  "DISPUTED",
  "RESOLVED",
  "CANCELLED",
] as const;

function shouldClearFailedPendingTx(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("reverted on-chain") ||
    normalized.includes("rejected in wallet") ||
    normalized.includes("user rejected") ||
    normalized.includes("user denied")
  );
}

export function DealDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tradeId = id as `0x${string}` | undefined;

  const { address, isConnected, isAuthenticated, openWalletModal, signInWithWallet } = useAuthSession();
  const dealQuery = useDealQuery(tradeId, isAuthenticated);
  const historyQuery = useDealHistoryQuery(tradeId, isAuthenticated);
  const syncMutation = useSyncDealMutation();
  const bindTxMutation = useBindDealTxMutation();
  const createDisputeMutation = useCreateDisputeMutation();

  const onChainQuery = useOnChainTrade(tradeId);
  const claimableQuery = useClaimableBalance(address);
  const executor = useEscrowContractExecutor();
  const { pendingTx, setPending, clearPending } = usePendingTxPersistence(tradeId ?? "unknown");

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [verifiedTermsHash, setVerifiedTermsHash] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSummary, setDisputeSummary] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  const deal = dealQuery.data;

  const { waitForHash } = executor;
  const { mutateAsync: bindDealTxAsync } = bindTxMutation;
  const { mutateAsync: syncDealAsync } = syncMutation;

  const mountedRef = useRef(true);
  const inFlightActionRef = useRef(false);
  const recoveredPendingHashRef = useRef<string | null>(null);
  const refetchOnChainRef = useRef(onChainQuery.refetch);
  const refetchClaimableRef = useRef(claimableQuery.refetch);
  refetchOnChainRef.current = onChainQuery.refetch;
  refetchClaimableRef.current = claimableQuery.refetch;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    recoveredPendingHashRef.current = null;
    setActionError(null);
    setActionSuccess(null);
  }, [tradeId]);

  // Resume pending tx waiting only after browser reload (never duplicate active in-mount submissions)
  useEffect(() => {
    if (!pendingTx) {
      recoveredPendingHashRef.current = null;
      return;
    }
    if (!tradeId || !isAuthenticated) return;
    if (inFlightActionRef.current || recoveredPendingHashRef.current === pendingTx.txHash) return;

    recoveredPendingHashRef.current = pendingTx.txHash;
    const targetTxHash = pendingTx.txHash;
    const targetAction = pendingTx.action;

    void (async () => {
      try {
        const result = await waitForHash(targetTxHash);
        if (!mountedRef.current) return;

        if (targetAction === "createTrade") {
          await bindDealTxAsync({ tradeId, txHash: result.txHash });
        } else if (targetAction !== "withdraw") {
          await syncDealAsync({ tradeId, txHash: result.txHash });
        }

        if (!mountedRef.current) return;
        await Promise.all([refetchOnChainRef.current(), refetchClaimableRef.current()]);
        clearPending();
        recoveredPendingHashRef.current = null;
        if (mountedRef.current) {
          setActionSuccess(`Pending ${targetAction} transaction confirmed (${result.txHash}).`);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Pending transaction failed.";
        if (shouldClearFailedPendingTx(message)) {
          clearPending();
          recoveredPendingHashRef.current = null;
        }
        setActionError(message);
      }
    })();
  }, [
    bindDealTxAsync,
    clearPending,
    isAuthenticated,
    pendingTx,
    syncDealAsync,
    tradeId,
    waitForHash,
  ]);

  // Verify terms hash client-side against deal parameters
  useEffect(() => {
    if (!deal) return;
    let active = true;
    void computeCanonicalTermsHash({
      version: 1,
      chainId: deal.chainId,
      seller: deal.seller,
      buyer: deal.buyer,
      arbiter: deal.arbiter,
      amountWei: deal.amountWei,
      fundingDeadline: Math.floor(Date.parse(deal.fundingDeadline) / 1000),
      deliveryDeadline: Math.floor(Date.parse(deal.deliveryDeadline) / 1000),
      inspectionWindowSeconds: deal.inspectionWindowSeconds,
      title: deal.title,
      description: deal.description,
      terms: deal.terms,
    }).then((res) => {
      if (active) setVerifiedTermsHash(res.termsHash);
    });
    return () => {
      active = false;
    };
  }, [deal]);

  const onChainStatusIndex = onChainQuery.data ? Number(onChainQuery.data.status) : null;
  const onChainStatus =
    onChainStatusIndex !== null && onChainStatusIndex >= 0 && onChainStatusIndex < CHAIN_STATUS_NAMES.length
      ? CHAIN_STATUS_NAMES[onChainStatusIndex]
      : null;

  const effectiveStatus = onChainStatus && onChainStatus !== "NONE" ? onChainStatus : deal?.status;

  const me = address?.toLowerCase();
  const isSeller = Boolean(me && deal && deal.seller.toLowerCase() === me);
  const isBuyer = Boolean(me && deal?.buyer && deal.buyer.toLowerCase() === me);
  const isArbiter = Boolean(me && deal && deal.arbiter.toLowerCase() === me);
  const isOpenBuyerEligible = Boolean(
    me && deal && !deal.buyer && !isSeller && !isArbiter
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const fundingDeadlineEpoch = deal ? Math.floor(Date.parse(deal.fundingDeadline) / 1000) : 0;
  const deliveryDeadlineEpoch = deal ? Math.floor(Date.parse(deal.deliveryDeadline) / 1000) : 0;
  const deliveredAtEpoch = deal?.deliveredAt ? Math.floor(Date.parse(deal.deliveredAt) / 1000) : 0;
  const sellerDisputeUnlockEpoch = deal ? deliveredAtEpoch + deal.inspectionWindowSeconds : 0;

  const termsHashVerified = useMemo(() => {
    if (!deal || !verifiedTermsHash) return false;
    return verifiedTermsHash.toLowerCase() === deal.termsHash.toLowerCase();
  }, [deal, verifiedTermsHash]);

  async function runAndSync(
    actionName: string,
    fn: (onHash: (hash: `0x${string}`) => void) => Promise<{ txHash: `0x${string}` }>
  ) {
    if (!tradeId) return;
    setActionError(null);
    setActionSuccess(null);
    inFlightActionRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    let confirmedTxHash: `0x${string}` | null = null;
    try {
      const result = await fn((hash) => {
        submittedTxHash = hash;
        recoveredPendingHashRef.current = hash;
        setPending(hash, actionName);
      });
      confirmedTxHash = result.txHash;
      if (actionName === "createTrade") {
        await bindDealTxAsync({ tradeId, txHash: result.txHash });
      } else {
        await syncDealAsync({ tradeId, txHash: result.txHash });
      }
      clearPending();
      recoveredPendingHashRef.current = null;
      await Promise.all([refetchOnChainRef.current(), refetchClaimableRef.current()]);
      if (mountedRef.current) {
        setActionSuccess(`${actionName} confirmed on-chain (${result.txHash}).`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `${actionName} failed.`;
      if (!confirmedTxHash && (!submittedTxHash || shouldClearFailedPendingTx(message))) {
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      if (mountedRef.current) {
        setActionError(message);
      }
    } finally {
      inFlightActionRef.current = false;
    }
  }

  async function handleWithdraw() {
    setActionError(null);
    setActionSuccess(null);
    inFlightActionRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    let confirmedTxHash: `0x${string}` | null = null;
    try {
      const result = await executor.withdraw((hash) => {
        submittedTxHash = hash;
        recoveredPendingHashRef.current = hash;
        setPending(hash, "withdraw");
      });
      confirmedTxHash = result.txHash;
      clearPending();
      recoveredPendingHashRef.current = null;
      await Promise.all([refetchOnChainRef.current(), refetchClaimableRef.current()]);
      if (mountedRef.current) {
        setActionSuccess(`Withdrawal confirmed on-chain (${result.txHash}).`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Withdrawal failed.";
      if (!confirmedTxHash && (!submittedTxHash || shouldClearFailedPendingTx(message))) {
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      if (mountedRef.current) {
        setActionError(message);
      }
    } finally {
      inFlightActionRef.current = false;
    }
  }

  async function handleManualSync() {
    if (!deal) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      if (pendingTx?.action === "createTrade" && !deal.onChainBound) {
        await bindDealTxAsync({ tradeId: deal.tradeId, txHash: pendingTx.txHash });
      }
      const syncTxHash =
        pendingTx && pendingTx.action !== "withdraw" && pendingTx.action !== "createTrade"
          ? pendingTx.txHash
          : undefined;
      const synced = await syncDealAsync({ tradeId: deal.tradeId, txHash: syncTxHash });
      clearPending();
      recoveredPendingHashRef.current = null;
      await Promise.all([refetchOnChainRef.current(), refetchClaimableRef.current()]);
      if (mountedRef.current) {
        setActionSuccess(`Deal synced from chain (${synced.status}).`);
      }
    } catch (err) {
      if (mountedRef.current) {
        setActionError(err instanceof Error ? err.message : "Failed to sync on-chain state.");
      }
    }
  }

  async function handleOpenDisputeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tradeId || !deal || inFlightActionRef.current) return;
    setActionError(null);
    if (disputeReason.trim().length < 5 || disputeSummary.trim().length < 10) {
      setActionError("Enter a clear dispute reason (5+ chars) and summary (10+ chars).");
      return;
    }

    inFlightActionRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    let confirmedTxHash: `0x${string}` | undefined;
    try {
      let txHash: `0x${string}` | undefined =
        effectiveStatus === "DISPUTED" && pendingTx?.action === "openDispute"
          ? pendingTx.txHash
          : undefined;
      if (effectiveStatus !== "DISPUTED") {
        const res =
          pendingTx?.action === "openDispute"
            ? await executor.waitForHash(pendingTx.txHash)
            : await executor.openDispute(tradeId, (hash) => {
                submittedTxHash = hash;
                recoveredPendingHashRef.current = hash;
                setPending(hash, "openDispute");
              });
        txHash = res.txHash;
        confirmedTxHash = txHash;
        await syncDealAsync({ tradeId, txHash });
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      const dispute = await createDisputeMutation.mutateAsync({
        tradeId,
        reason: disputeReason.trim(),
        summary: disputeSummary.trim(),
        txHash,
      });
      if (pendingTx?.action === "openDispute") {
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      navigate(disputePath(String(dispute.id)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open dispute.";
      if (!confirmedTxHash && (!submittedTxHash || shouldClearFailedPendingTx(message))) {
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      if (mountedRef.current) {
        setActionError(message);
      }
    } finally {
      inFlightActionRef.current = false;
    }
  }

  const claimableWei = claimableQuery.data ?? 0n;

  return (
    <AppShell
      title={deal ? deal.title : "Deal Details"}
      subtitle={tradeId ? `Trade ID: ${tradeId}` : undefined}
    >
      {!isConnected ? (
        <EmptyState
          title="Connect wallet to inspect deal"
          description="Connect your wallet and sign in to view verified terms, on-chain status, and available escrow actions."
          action={<Button onClick={openWalletModal}>Connect Wallet</Button>}
        />
      ) : !isAuthenticated ? (
        <EmptyState
          title="Sign in required"
          description="Authenticate your wallet session via SIWE to load this deal."
          action={<Button onClick={() => void signInWithWallet()}>Sign In with Wallet</Button>}
        />
      ) : dealQuery.isLoading ? (
        <LoadingState label="Loading deal and verifying on-chain state..." />
      ) : dealQuery.isError || !deal ? (
        <AlertBanner
          tone="error"
          title="Deal Unavailable"
          message={dealQuery.error instanceof Error ? dealQuery.error.message : "Could not load deal."}
        />
      ) : (
        <div className="space-y-6">
          {(actionError || executor.txError) && (
            <AlertBanner tone="error" title="Transaction Issue" message={actionError ?? executor.txError ?? ""} />
          )}
          {actionSuccess && <AlertBanner tone="success" title="Verified" message={actionSuccess} />}
          {pendingTx && (
            <AlertBanner
              tone="info"
              title={`Pending ${pendingTx.action}`}
              message={`Waiting for receipt of ${pendingTx.txHash}...`}
            />
          )}

          {claimableWei > 0n && (
            <AlertBanner
              tone="success"
              title="Funds Available to Claim"
              message={`Your wallet has ${formatAvax(claimableWei)} ready for pull-withdrawal.`}
              action={
                <Button
                  size="sm"
                  disabled={Boolean(executor.activeAction)}
                  onClick={() => void handleWithdraw()}
                >
                  Withdraw AVAX
                </Button>
              }
            />
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={deal.status} />
                    {onChainStatus && onChainStatus !== deal.status && (
                      <span className="text-xs text-amber-300">
                        On-chain state: {onChainStatus} (sync recommended)
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-white/80">{deal.description}</p>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={syncMutation.isPending}
                  onClick={() => void handleManualSync()}
                >
                  <RefreshCw size={14} />
                  <span>{syncMutation.isPending ? "Syncing..." : "Sync On-Chain"}</span>
                </Button>
              </div>

              <div>
                <h2 className="text-sm font-medium text-white">Agreed Terms & Acceptance Criteria</h2>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-black p-4 font-geist text-sm text-white/80">
                  {deal.terms}
                </pre>
                <p className="mt-2 text-xs text-white/50">
                  Canonical Terms Hash:{" "}
                  <code className="font-mono text-white/80">{deal.termsHash}</code>{" "}
                  {termsHashVerified ? (
                    <span className="text-emerald-300">(client SHA-256 verified)</span>
                  ) : (
                    <span className="text-amber-300">(verifying...)</span>
                  )}
                </p>
              </div>

              <div className="space-y-3 border-t border-white/10 pt-5">
                <h2 className="text-sm font-medium text-white">Available Actions</h2>

                <div className="flex flex-wrap gap-3">
                  {effectiveStatus === "DRAFT" && isSeller && (
                    <Button
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                      onClick={() =>
                        void runAndSync("createTrade", (onHash) =>
                          executor.createTrade(
                            {
                              tradeId: deal.tradeId,
                              preassignedBuyer: deal.buyer ?? zeroAddress,
                              arbiter: deal.arbiter,
                              amountWei: BigInt(deal.amountWei),
                              termsHash: deal.termsHash,
                              fundingDeadline: BigInt(fundingDeadlineEpoch),
                              deliveryDeadline: BigInt(deliveryDeadlineEpoch),
                              inspectionWindow: BigInt(deal.inspectionWindowSeconds),
                            },
                            onHash
                          )
                        )
                      }
                    >
                      Deploy Trade On-Chain
                    </Button>
                  )}

                  {effectiveStatus === "CREATED" && (isBuyer || isOpenBuyerEligible) && nowSeconds <= fundingDeadlineEpoch && (
                    <Button
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                      onClick={() =>
                        void runAndSync("fundTrade", (onHash) =>
                          executor.fundTrade(deal.tradeId, BigInt(deal.amountWei), onHash)
                        )
                      }
                    >
                      Fund Escrow ({formatAvax(deal.amountWei)})
                    </Button>
                  )}

                  {effectiveStatus === "CREATED" && isSeller && (
                    <Button
                      variant="secondary"
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                      onClick={() =>
                        void runAndSync("cancelUnfundedTrade", (onHash) =>
                          executor.cancelUnfundedTrade(deal.tradeId, onHash)
                        )
                      }
                    >
                      Cancel Unfunded Deal
                    </Button>
                  )}

                  {effectiveStatus === "FUNDED" && isSeller && (
                    <>
                      <Button
                        disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                        onClick={() =>
                          void runAndSync("markDelivered", (onHash) =>
                            executor.markDelivered(deal.tradeId, onHash)
                          )
                        }
                      >
                        Mark Delivered
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                        onClick={() =>
                          void runAndSync("refundBySeller", (onHash) =>
                            executor.refundBySeller(deal.tradeId, onHash)
                          )
                        }
                      >
                        Voluntary Refund to Buyer
                      </Button>
                    </>
                  )}

                  {effectiveStatus === "FUNDED" && isBuyer && nowSeconds > deliveryDeadlineEpoch && (
                    <Button
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                      onClick={() =>
                        void runAndSync("refundAfterDeadline", (onHash) =>
                          executor.refundAfterDeadline(deal.tradeId, onHash)
                        )
                      }
                    >
                      Claim Deadline Refund
                    </Button>
                  )}

                  {effectiveStatus === "DELIVERED" && isBuyer && (
                    <Button
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || bindTxMutation.isPending}
                      onClick={() =>
                        void runAndSync("releaseFunds", (onHash) =>
                          executor.releaseFunds(deal.tradeId, onHash)
                        )
                      }
                    >
                      Approve & Release Funds
                    </Button>
                  )}

                  {((effectiveStatus === "FUNDED" && (isBuyer || isSeller)) ||
                    (effectiveStatus === "DELIVERED" &&
                      (isBuyer || (isSeller && nowSeconds > sellerDisputeUnlockEpoch)))) && (
                    <Button
                      variant="danger"
                      disabled={Boolean(executor.activeAction) || syncMutation.isPending || createDisputeMutation.isPending}
                      onClick={() => setShowDisputeForm((v) => !v)}
                    >
                      <ShieldAlert size={15} />
                      <span>Open Dispute</span>
                    </Button>
                  )}

                  {deal.disputeId && (
                    <Link
                      to={disputePath(String(deal.disputeId))}
                      className="inline-flex items-center rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                    >
                      Open Dispute Center
                    </Link>
                  )}

                  {effectiveStatus === "DISPUTED" && !deal.disputeId && (isBuyer || isSeller) && (
                    <Button variant="secondary" onClick={() => setShowDisputeForm(true)}>
                      Attach Dispute Metadata
                    </Button>
                  )}
                </div>

                {showDisputeForm && (
                  <form
                    onSubmit={handleOpenDisputeSubmit}
                    className="mt-4 space-y-3 rounded-xl border border-red-400/30 bg-red-500/5 p-4"
                  >
                    <p className="text-sm font-medium text-white">
                      {effectiveStatus === "DISPUTED"
                        ? "Attach Off-Chain Dispute Details"
                        : "Open On-Chain Dispute & Submit Details"}
                    </p>
                    <input
                      type="text"
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      placeholder="Short reason (e.g. Deliverable incomplete)"
                      className="w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
                    />
                    <textarea
                      rows={3}
                      value={disputeSummary}
                      onChange={(e) => setDisputeSummary(e.target.value)}
                      placeholder="Explain the dispute facts for the arbiter"
                      className="w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="danger"
                        size="sm"
                        disabled={
                          Boolean(executor.activeAction) ||
                          createDisputeMutation.isPending ||
                          syncMutation.isPending
                        }
                      >
                        Confirm Dispute
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowDisputeForm(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </Panel>

            <Panel className="space-y-4">
              <h2 className="text-base font-medium text-white">Escrow Parameters</h2>
              <dl className="space-y-3 text-xs">
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Escrow Value</dt>
                  <dd className="mt-1 font-mono text-base font-medium text-white">{formatAvax(deal.amountWei)}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Seller</dt>
                  <dd className="mt-1 font-mono break-all text-white/90">{deal.seller}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Buyer</dt>
                  <dd className="mt-1 font-mono break-all text-white/90">
                    {deal.buyer ?? "Open (any eligible buyer)"}
                  </dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Human Arbiter</dt>
                  <dd className="mt-1 font-mono break-all text-white/90">{deal.arbiter}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Funding Deadline</dt>
                  <dd className="mt-1 text-white/85">{formatTimestamp(deal.fundingDeadline)}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Delivery Deadline</dt>
                  <dd className="mt-1 text-white/85">{formatTimestamp(deal.deliveryDeadline)}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Inspection Window</dt>
                  <dd className="mt-1 text-white/85">{formatDurationSeconds(deal.inspectionWindowSeconds)}</dd>
                </div>
              </dl>

              {deal.contractAddress && (
                <div className="border-t border-white/10 pt-3 text-xs">
                  <p className="text-white/45">Contract Address</p>
                  {getExplorerAddressUrl(deal.contractAddress) ? (
                    <a
                      href={getExplorerAddressUrl(deal.contractAddress)!}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-white underline break-all"
                    >
                      <span>{deal.contractAddress}</span>
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <p className="mt-1 font-mono break-all text-white/75">{deal.contractAddress}</p>
                  )}
                </div>
              )}
            </Panel>
          </div>

          <Panel className="space-y-4">
            <h2 className="text-base font-medium text-white">Verified Timeline & Transactions</h2>
            {historyQuery.isLoading ? (
              <p className="text-sm text-white/50">Loading timeline...</p>
            ) : !historyQuery.data || historyQuery.data.events.length === 0 ? (
              <p className="text-sm text-white/50">No verified events recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {historyQuery.data.events.map((event) => {
                  const txUrl = event.txHash ? getExplorerTxUrl(event.txHash) : null;
                  return (
                    <div
                      key={event.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black p-3.5 text-xs"
                    >
                      <div>
                        <p className="font-medium text-white">{event.eventType}</p>
                        <p className="mt-0.5 text-white/60">{event.details}</p>
                      </div>
                      <div className="text-right text-white/50">
                        <p>{formatTimestamp(event.createdAt)}</p>
                        {event.txHash && (
                          <p className="mt-0.5 font-mono">
                            {txUrl ? (
                              <a href={txUrl} target="_blank" rel="noreferrer" className="underline hover:text-white">
                                {event.txHash.slice(0, 12)}...
                              </a>
                            ) : (
                              `${event.txHash.slice(0, 14)}...`
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
