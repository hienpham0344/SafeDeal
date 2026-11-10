import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther } from "viem";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { disputePath } from "@/config/routes";
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
import { formatAvax, formatTimestamp } from "@/utils/format";

function shouldClearFailedPendingTx(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("reverted on-chain") ||
    normalized.includes("rejected in wallet") ||
    normalized.includes("user rejected") ||
    normalized.includes("user denied")
  );
}

function ArbiterDisputeCard({ dispute }: { readonly dispute: DisputeDetail }) {
  const totalAvax = formatEther(BigInt(dispute.dealAmountWei));
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
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-base font-medium text-white">
            Dispute #{dispute.id} · {dispute.dealTitle}
          </h2>
          <p className="mt-1 font-mono text-xs text-white/50">
            Trade {dispute.tradeId} · Locked: {formatAvax(dispute.dealAmountWei)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={dispute.status} />
          <Link
            to={disputePath(String(dispute.id))}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Inspect Evidence
          </Link>
        </div>
      </div>

      <p className="text-sm text-white/75">{dispute.summary}</p>
      <p className="text-xs text-white/50">
        Buyer: <span className="font-mono">{dispute.buyer}</span> · Seller:{" "}
        <span className="font-mono">{dispute.seller}</span> · Opened {formatTimestamp(dispute.createdAt)}
      </p>

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
        <div className="rounded-xl border border-white/15 bg-black/50 p-3 text-xs text-white/75 space-y-1">
          <p>
            Buyer Award: <span className="font-mono text-white">{formatAvax(dispute.buyerAwardWei ?? "0")}</span>{" "}
            · Seller Award: <span className="font-mono text-white">{formatAvax(dispute.sellerAwardWei ?? "0")}</span>
          </p>
          <p className="text-white/65">Rationale: {dispute.resolutionRationale}</p>
        </div>
      )}

      {showSettlementForm && (
        <form onSubmit={handleResolve} className="space-y-3 border-t border-white/10 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`buyer-alloc-${dispute.id}`} className="block text-xs text-white/60">
                Buyer Allocation (AVAX)
              </label>
              <input
                id={`buyer-alloc-${dispute.id}`}
                type="text"
                value={buyerAvax}
                disabled={Boolean(activeResolveTxHash)}
                onChange={(e) => setBuyerAvax(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 font-mono text-sm text-white disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor={`seller-alloc-${dispute.id}`} className="block text-xs text-white/60">
                Seller Allocation (AVAX)
              </label>
              <input
                id={`seller-alloc-${dispute.id}`}
                type="text"
                value={sellerAvax}
                disabled={Boolean(activeResolveTxHash)}
                onChange={(e) => setSellerAvax(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 font-mono text-sm text-white disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`rationale-${dispute.id}`} className="block text-xs text-white/60">
              Arbitration Rationale
            </label>
            <textarea
              id={`rationale-${dispute.id}`}
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Document the evidence review and settlement rationale"
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
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
