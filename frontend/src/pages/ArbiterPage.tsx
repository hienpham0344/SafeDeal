import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther, parseEther } from "viem";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { disputePath, ROUTES } from "@/config/routes";
import {
  validateSplitAllocation,
} from "@/features/arbitration/api/arbitration-api";
import {
  useAssignedDisputesQuery,
  useRecordResolutionMutation,
} from "@/features/arbitration/hooks/useArbitration";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { usePendingTxPersistence } from "@/features/deals/hooks/usePendingTransactions";
import { useEscrowContractExecutor } from "@/features/escrow/hooks/useEscrowActions";
import type { DisputeDetail } from "@/types/api";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

function shouldClearFailedPendingTx(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("reverted on-chain") ||
    normalized.includes("rejected in wallet") ||
    normalized.includes("user rejected") ||
    normalized.includes("user denied")
  );
}

function parseAvaxSafe(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;
  try {
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

function ArbiterDisputeCard({ dispute }: { readonly dispute: DisputeDetail }) {
  const totalWei = BigInt(dispute.dealAmountWei);
  const totalAvax = formatEther(totalWei);
  const [buyerAvax, setBuyerAvax] = useState(() =>
    dispute.buyerAwardWei ? formatEther(BigInt(dispute.buyerAwardWei)) : totalAvax
  );
  const [sellerAvax, setSellerAvax] = useState(() =>
    dispute.sellerAwardWei ? formatEther(BigInt(dispute.sellerAwardWei)) : "0"
  );
  const [rationale, setRationale] = useState("");
  const [confirmedResolveTxHash, setConfirmedResolveTxHash] = useState<`0x${string}` | null>(null);
  const [isRecoveringPending, setIsRecoveringPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { isConnected, isWrongNetwork, isAuthenticated } = useAuthSession();
  const executor = useEscrowContractExecutor();
  const recordResolution = useRecordResolutionMutation();
  const { waitForHash } = executor;
  const { pendingTx, setPending, clearPending } = usePendingTxPersistence(`arbiter-resolve-${dispute.id}`);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const recoveredPendingHashRef = useRef<string | null>(null);
  const confirmedResolveTxHashRef = useRef<`0x${string}` | null>(null);
  confirmedResolveTxHashRef.current = confirmedResolveTxHash;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sync split display values if backend indexer already captured on-chain awards
  useEffect(() => {
    if (dispute.buyerAwardWei) {
      setBuyerAvax(formatEther(BigInt(dispute.buyerAwardWei)));
    }
    if (dispute.sellerAwardWei) {
      setSellerAvax(formatEther(BigInt(dispute.sellerAwardWei)));
    }
  }, [dispute.buyerAwardWei, dispute.sellerAwardWei]);

  // Clear local recovery state once dispute resolution and rationale are both stored in backend
  useEffect(() => {
    if (dispute.status === "RESOLVED" && dispute.resolutionRationale?.trim()) {
      confirmedResolveTxHashRef.current = null;
      setConfirmedResolveTxHash(null);
      recoveredPendingHashRef.current = null;
      clearPending();
    }
  }, [clearPending, dispute.resolutionRationale, dispute.status]);

  // Recover a pending resolveDispute tx across reloads without prompting a duplicate settlement tx
  useEffect(() => {
    if (!pendingTx || pendingTx.action !== "resolveDispute") {
      recoveredPendingHashRef.current = null;
      return;
    }
    if (dispute.status === "RESOLVED" && dispute.resolveTxHash) {
      clearPending();
      return;
    }
    if (confirmedResolveTxHashRef.current) return;
    if (!isConnected || isWrongNetwork || !isAuthenticated) return;
    if (inFlightRef.current || recoveredPendingHashRef.current === pendingTx.txHash) return;

    recoveredPendingHashRef.current = pendingTx.txHash;
    const targetTxHash = pendingTx.txHash;
    setIsRecoveringPending(true);
    setErrorMsg(null);

    void (async () => {
      try {
        const recovered = await waitForHash(targetTxHash);
        if (!mountedRef.current) return;
        confirmedResolveTxHashRef.current = recovered.txHash;
        setConfirmedResolveTxHash(recovered.txHash);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Failed to verify pending settlement transaction.";
        if (shouldClearFailedPendingTx(message)) {
          clearPending();
          recoveredPendingHashRef.current = null;
        }
        setErrorMsg(message);
      } finally {
        if (mountedRef.current) {
          setIsRecoveringPending(false);
        }
      }
    })();
  }, [
    clearPending,
    dispute.resolveTxHash,
    dispute.status,
    isAuthenticated,
    isConnected,
    isWrongNetwork,
    pendingTx,
    waitForHash,
  ]);

  const activeResolveTxHash =
    confirmedResolveTxHash ??
    (dispute.status === "RESOLVED" && dispute.resolveTxHash ? dispute.resolveTxHash : null);
  const needsRationaleBackfill =
    dispute.status === "RESOLVED" &&
    (!dispute.resolutionRationale || dispute.resolutionRationale.trim().length === 0) &&
    Boolean(dispute.resolveTxHash);
  const showSettlementForm =
    dispute.status === "OPEN" || needsRationaleBackfill || Boolean(confirmedResolveTxHash);

  const buyerWei = parseAvaxSafe(buyerAvax);
  const sellerWei = parseAvaxSafe(sellerAvax);
  const allocatedWei = buyerWei !== null && sellerWei !== null ? buyerWei + sellerWei : null;
  const isExactMatch = allocatedWei !== null && allocatedWei === totalWei;
  const isOverAllocated = allocatedWei !== null && allocatedWei > totalWei;

  let buyerWidthPct = 0;
  let sellerWidthPct = 0;
  if (buyerWei !== null && sellerWei !== null && totalWei > 0n) {
    const denominator = allocatedWei !== null && allocatedWei > totalWei ? allocatedWei : totalWei;
    buyerWidthPct = Number((buyerWei * 10000n) / denominator) / 100;
    sellerWidthPct = Number((sellerWei * 10000n) / denominator) / 100;
  }

  const isAllocationLocked = Boolean(activeResolveTxHash);

  function applySplitPreset(preset: "BUYER_ALL" | "SPLIT_HALF" | "SELLER_ALL") {
    if (isAllocationLocked) return;
    if (preset === "BUYER_ALL") {
      setBuyerAvax(formatEther(totalWei));
      setSellerAvax("0");
      return;
    }
    if (preset === "SELLER_ALL") {
      setBuyerAvax("0");
      setSellerAvax(formatEther(totalWei));
      return;
    }
    const half = totalWei / 2n;
    const remainder = totalWei - half;
    setBuyerAvax(formatEther(half));
    setSellerAvax(formatEther(remainder));
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (inFlightRef.current) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (rationale.trim().length < 10) {
      setErrorMsg("Provide an arbitration rationale of at least 10 characters.");
      return;
    }

    const existingTxHash =
      confirmedResolveTxHashRef.current ??
      (dispute.status === "RESOLVED" && dispute.resolveTxHash ? dispute.resolveTxHash : null);

    let split: { buyerWei: bigint; sellerWei: bigint } | null = null;
    if (!existingTxHash && !(pendingTx?.action === "resolveDispute")) {
      const parsed = validateSplitAllocation(buyerAvax, sellerAvax, dispute.dealAmountWei);
      if ("error" in parsed) {
        setErrorMsg(parsed.error);
        return;
      }
      split = parsed;
    }

    inFlightRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    try {
      let targetTxHash: `0x${string}`;
      if (existingTxHash) {
        targetTxHash = existingTxHash;
      } else if (pendingTx?.action === "resolveDispute") {
        const recovered = await waitForHash(pendingTx.txHash);
        confirmedResolveTxHashRef.current = recovered.txHash;
        if (mountedRef.current) {
          setConfirmedResolveTxHash(recovered.txHash);
        }
        targetTxHash = recovered.txHash;
      } else {
        const tx = await executor.resolveDispute(
          dispute.tradeId,
          split!.buyerWei,
          split!.sellerWei,
          (hash) => {
            submittedTxHash = hash;
            recoveredPendingHashRef.current = hash;
            setPending(hash, "resolveDispute");
          }
        );
        confirmedResolveTxHashRef.current = tx.txHash;
        if (mountedRef.current) {
          setConfirmedResolveTxHash(tx.txHash);
        }
        targetTxHash = tx.txHash;
      }

      await recordResolution.mutateAsync({
        disputeId: dispute.id,
        txHash: targetTxHash,
        rationale: rationale.trim(),
      });

      clearPending();
      recoveredPendingHashRef.current = null;
      confirmedResolveTxHashRef.current = null;
      if (mountedRef.current) {
        setConfirmedResolveTxHash(null);
        setSuccessMsg(
          needsRationaleBackfill
            ? `Arbitration rationale recorded for settlement (${targetTxHash}).`
            : `Dispute settled on-chain (${targetTxHash}). Beneficiaries may now withdraw.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Resolution transaction failed.";
      if (
        !confirmedResolveTxHashRef.current &&
        (!submittedTxHash || shouldClearFailedPendingTx(message))
      ) {
        clearPending();
        recoveredPendingHashRef.current = null;
      }
      if (mountedRef.current) {
        setErrorMsg(message);
      }
    } finally {
      inFlightRef.current = false;
    }
  }

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

      {errorMsg && <AlertBanner tone="error" message={errorMsg} />}
      {successMsg && <AlertBanner tone="success" message={successMsg} />}
      {!successMsg && activeResolveTxHash && showSettlementForm && (
        <AlertBanner
          tone="info"
          title={needsRationaleBackfill ? "Settlement Indexed On-Chain" : "On-Chain Settlement Confirmed"}
          message={
            needsRationaleBackfill
              ? `Transaction ${activeResolveTxHash} is already settled on-chain. Save your arbitration rationale to complete the record.`
              : `Transaction ${activeResolveTxHash} succeeded on-chain. Submit your rationale below to retry backend recording without re-submitting on-chain.`
          }
        />
      )}

      {dispute.status === "RESOLVED" && dispute.resolutionRationale && (
        <div className="rounded-xl border border-sd-lineStrong bg-sd-elevated/70 p-4 text-xs text-sd-inkMuted space-y-1.5">
          <p className="tabular-nums">
            Buyer Award: <span className="font-mono text-white">{formatAvax(dispute.buyerAwardWei ?? "0")}</span>{" "}
            · Seller Award:{" "}
            <span className="font-mono text-white">{formatAvax(dispute.sellerAwardWei ?? "0")}</span>
          </p>
          <p className="leading-relaxed text-sd-inkMuted">Rationale: {dispute.resolutionRationale}</p>
        </div>
      )}

      {showSettlementForm && (
        <form onSubmit={handleResolve} className="space-y-4 border-t border-sd-line pt-5">
          <div className="rounded-xl border border-sd-line bg-sd-inset p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-sd-ink">Split Allocation</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={isAllocationLocked}
                  onClick={() => applySplitPreset("BUYER_ALL")}
                  className="inline-flex min-h-[30px] items-center rounded-md border border-sd-lineStrong bg-sd-elevated px-2.5 py-1 text-[11px] font-medium text-sd-ink transition-colors hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  100% Buyer
                </button>
                <button
                  type="button"
                  disabled={isAllocationLocked}
                  onClick={() => applySplitPreset("SPLIT_HALF")}
                  className="inline-flex min-h-[30px] items-center rounded-md border border-sd-lineStrong bg-sd-elevated px-2.5 py-1 text-[11px] font-medium text-sd-ink transition-colors hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  50 / 50
                </button>
                <button
                  type="button"
                  disabled={isAllocationLocked}
                  onClick={() => applySplitPreset("SELLER_ALL")}
                  className="inline-flex min-h-[30px] items-center rounded-md border border-sd-lineStrong bg-sd-elevated px-2.5 py-1 text-[11px] font-medium text-sd-ink transition-colors hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  100% Seller
                </button>
              </div>
            </div>

            <div
              aria-label="Escrow split visualization"
              className={`flex h-2.5 w-full overflow-hidden rounded-full border bg-sd-canvas ${
                isOverAllocated ? "border-red-400/60" : "border-sd-line"
              }`}
            >
              {buyerWidthPct > 0 && (
                <div
                  style={{ width: `${buyerWidthPct}%` }}
                  className="h-full bg-sky-400 transition-all duration-150"
                />
              )}
              {sellerWidthPct > 0 && (
                <div
                  style={{ width: `${sellerWidthPct}%` }}
                  className="h-full bg-emerald-400 transition-all duration-150"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="font-mono tabular-nums text-sd-inkMuted">
                Locked: {totalAvax} AVAX · Allocated:{" "}
                <span className={isExactMatch ? "text-emerald-300" : "text-amber-300"}>
                  {allocatedWei !== null ? formatEther(allocatedWei) : "Invalid"} AVAX
                </span>
              </p>
              <div className="flex items-center gap-3 font-mono text-[11px] text-sd-inkSubtle">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden="true" />
                  Buyer
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                  Seller
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`buyer-alloc-${dispute.id}`} className="block text-xs font-medium text-sd-inkMuted">
                Buyer Allocation (AVAX)
              </label>
              <input
                id={`buyer-alloc-${dispute.id}`}
                type="text"
                value={buyerAvax}
                disabled={isAllocationLocked}
                onChange={(e) => setBuyerAvax(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 font-mono text-sm text-white tabular-nums focus:border-sd-accent focus:outline-none disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor={`seller-alloc-${dispute.id}`} className="block text-xs font-medium text-sd-inkMuted">
                Seller Allocation (AVAX)
              </label>
              <input
                id={`seller-alloc-${dispute.id}`}
                type="text"
                value={sellerAvax}
                disabled={isAllocationLocked}
                onChange={(e) => setSellerAvax(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 font-mono text-sm text-white tabular-nums focus:border-sd-accent focus:outline-none disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`rationale-${dispute.id}`} className="block text-xs font-medium text-sd-inkMuted">
              Arbitration Rationale
            </label>
            <textarea
              id={`rationale-${dispute.id}`}
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Document the evidence review and settlement rationale"
              className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none"
            />
          </div>

          <Button
            type="submit"
            disabled={Boolean(executor.activeAction) || isRecoveringPending || recordResolution.isPending}
          >
            {executor.activeAction === "resolveDispute"
              ? "Approve in Wallet..."
              : isRecoveringPending
                ? "Checking Settlement Tx..."
                : recordResolution.isPending
                  ? "Recording Settlement..."
                  : activeResolveTxHash
                    ? needsRationaleBackfill
                      ? "Save Arbitration Rationale"
                      : "Retry Recording Settlement"
                    : "Sign & Submit Settlement On-Chain"}
          </Button>
        </form>
      )}
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
      subtitle="Disputes assigned to your connected wallet. Every settlement requires explicit wallet signature."
    >
      {!isConnected ? (
        <EmptyState
          title="Connect arbiter wallet"
          description="Connect the designated arbiter wallet to review evidence and submit on-chain settlements."
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
