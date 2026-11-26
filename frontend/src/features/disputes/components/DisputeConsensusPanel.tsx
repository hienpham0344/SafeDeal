import { useEffect, useRef, useState } from "react";
import { formatEther, parseEther } from "viem";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { AlertBanner, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { appConfig } from "@/config/app.config";
import { validateSplitAllocation } from "@/features/arbitration/api/arbitration-api";
import { useRecordResolutionMutation } from "@/features/arbitration/hooks/useArbitration";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { usePendingTxPersistence } from "@/features/deals/hooks/usePendingTransactions";
import {
  useRecordTimeoutResolutionMutation,
  useSubmitDisputeVoteMutation,
} from "@/features/disputes/hooks/useDisputes";
import {
  useEscrowContractExecutor,
  useOnChainDisputeVotes,
} from "@/features/escrow/hooks/useEscrowActions";
import type { DisputeDetail, DisputeEvidenceItem, DisputeVote, VoterRole } from "@/types/api";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

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

function resolveCallerRole(address: string | undefined, dispute: DisputeDetail): VoterRole | null {
  if (!address) return null;
  const normalized = address.toLowerCase();
  if (dispute.buyer && dispute.buyer.toLowerCase() === normalized) return "BUYER";
  if (dispute.seller.toLowerCase() === normalized) return "SELLER";
  if (dispute.arbiter.toLowerCase() === normalized) return "ARBITER";
  return null;
}

function computeMatchingVoteStats(votes: readonly DisputeVote[]): {
  readonly maxMatches: number;
  readonly leadingProposalHash: string | null;
} {
  if (votes.length === 0) return { maxMatches: 0, leadingProposalHash: null };
  const counts = new Map<string, number>();
  let maxMatches = 0;
  let leadingProposalHash: string | null = null;
  for (const vote of votes) {
    const key = vote.proposalHash.toLowerCase();
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next > maxMatches) {
      maxMatches = next;
      leadingProposalHash = key;
    }
  }
  return { maxMatches, leadingProposalHash };
}

function formatDeadlineCountdown(targetIso: string | null): {
  readonly formatted: string;
  readonly isExpired: boolean;
  readonly remainingLabel: string;
} {
  if (!targetIso) {
    return { formatted: "Pending on-chain timestamp", isExpired: false, remainingLabel: "Pending" };
  }
  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs)) {
    return { formatted: targetIso, isExpired: false, remainingLabel: "Unknown" };
  }
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) {
    return { formatted: formatTimestamp(targetIso), isExpired: true, remainingLabel: "Expired" };
  }
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  const remainingLabel =
    days > 0 ? `${days}d ${hours}h left` : hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
  return { formatted: formatTimestamp(targetIso), isExpired: false, remainingLabel };
}

const ROLE_METADATA: Record<VoterRole, { readonly label: string; readonly badgeClass: string }> = {
  BUYER: {
    label: "Buyer",
    badgeClass: "border-sky-400/40 bg-sky-500/15 text-sky-200",
  },
  SELLER: {
    label: "Seller",
    badgeClass: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  },
  ARBITER: {
    label: "Arbiter",
    badgeClass: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  },
};

export interface DisputeConsensusPanelProps {
  readonly dispute: DisputeDetail;
  readonly evidence?: readonly DisputeEvidenceItem[];
  readonly variant?: "panel" | "embedded";
}

export function DisputeConsensusPanel({
  dispute,
  evidence,
  variant = "panel",
}: DisputeConsensusPanelProps) {
  const { address, isConnected, isWrongNetwork, isAuthenticated } = useAuthSession();
  const callerRole = resolveCallerRole(address, dispute);
  const votes = dispute.votes ?? [];

  const totalWei = BigInt(dispute.dealAmountWei);
  const totalAvax = formatEther(totalWei);
  const [buyerAvax, setBuyerAvax] = useState(() =>
    dispute.buyerAwardWei ? formatEther(BigInt(dispute.buyerAwardWei)) : totalAvax
  );
  const [sellerAvax, setSellerAvax] = useState(() =>
    dispute.sellerAwardWei ? formatEther(BigInt(dispute.sellerAwardWei)) : "0"
  );
  const [rationale, setRationale] = useState("");
  const [confirmedTxHash, setConfirmedTxHash] = useState<`0x${string}` | null>(null);
  const [confirmedAction, setConfirmedAction] = useState<"vote" | "timeout" | null>(null);
  const [isRecoveringPending, setIsRecoveringPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const executor = useEscrowContractExecutor();
  const onChainVotesQuery = useOnChainDisputeVotes(dispute.tradeId);
  const { waitForHash } = executor;
  const submitVote = useSubmitDisputeVoteMutation();
  const recordResolution = useRecordResolutionMutation();
  const recordTimeout = useRecordTimeoutResolutionMutation();

  const storageKey =
    callerRole === "ARBITER"
      ? `arbiter-resolve-${dispute.id}`
      : `dispute-vote-${dispute.id}-${callerRole ?? "viewer"}`;
  const { pendingTx, setPending, clearPending } = usePendingTxPersistence(storageKey);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const recoveredPendingHashRef = useRef<string | null>(null);
  const confirmedTxHashRef = useRef<`0x${string}` | null>(null);
  confirmedTxHashRef.current = confirmedTxHash;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (dispute.buyerAwardWei) {
      setBuyerAvax(formatEther(BigInt(dispute.buyerAwardWei)));
    }
    if (dispute.sellerAwardWei) {
      setSellerAvax(formatEther(BigInt(dispute.sellerAwardWei)));
    }
  }, [dispute.buyerAwardWei, dispute.sellerAwardWei]);

  const myVote = callerRole ? votes.find((v) => v.voterRole === callerRole) ?? null : null;

  useEffect(() => {
    if (dispute.status === "RESOLVED" && (dispute.resolutionRationale?.trim() || callerRole !== "ARBITER")) {
      confirmedTxHashRef.current = null;
      setConfirmedTxHash(null);
      setConfirmedAction(null);
      recoveredPendingHashRef.current = null;
      clearPending();
    }
  }, [callerRole, clearPending, dispute.resolutionRationale, dispute.status]);

  const pendingTxHash = pendingTx?.txHash ?? null;
  const pendingTxAction = pendingTx?.action ?? null;

  useEffect(() => {
    const isVoteAction =
      pendingTxAction === "submitResolutionVote" ||
      pendingTxAction === "resolveDispute" ||
      pendingTxAction === "resolveDisputeByTimeout";
    if (!pendingTxHash || !isVoteAction) {
      recoveredPendingHashRef.current = null;
      return;
    }
    if (dispute.status === "RESOLVED" && dispute.resolveTxHash) {
      clearPending();
      return;
    }
    if (myVote && myVote.txHash.toLowerCase() === pendingTxHash.toLowerCase()) {
      clearPending();
      return;
    }
    if (confirmedTxHashRef.current) return;
    if (!isConnected || isWrongNetwork || !isAuthenticated) return;
    if (inFlightRef.current || recoveredPendingHashRef.current === pendingTxHash) return;

    let cancelled = false;
    recoveredPendingHashRef.current = pendingTxHash;
    const targetTxHash = pendingTxHash;
    setIsRecoveringPending(true);
    setErrorMsg(null);

    void (async () => {
      try {
        const recovered = await waitForHash(targetTxHash);
        if (cancelled || !mountedRef.current) return;
        confirmedTxHashRef.current = recovered.txHash;
        setConfirmedTxHash(recovered.txHash);
        setConfirmedAction(pendingTxAction === "resolveDisputeByTimeout" ? "timeout" : "vote");
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Failed to verify pending settlement transaction.";
        if (shouldClearFailedPendingTx(message)) {
          clearPending();
          recoveredPendingHashRef.current = null;
        } else {
          recoveredPendingHashRef.current = null;
        }
        setErrorMsg(message);
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsRecoveringPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    clearPending,
    dispute.resolveTxHash,
    dispute.status,
    isAuthenticated,
    isConnected,
    isWrongNetwork,
    myVote,
    pendingTxAction,
    pendingTxHash,
    waitForHash,
  ]);

  const activeResolveTxHash =
    confirmedTxHash ??
    (dispute.status === "RESOLVED" && dispute.resolveTxHash ? dispute.resolveTxHash : null);
  const needsRationaleBackfill =
    callerRole === "ARBITER" &&
    dispute.status === "RESOLVED" &&
    (!dispute.resolutionRationale || dispute.resolutionRationale.trim().length === 0) &&
    Boolean(dispute.resolveTxHash);
  const canParticipate = callerRole !== null;
  const showVotingForm =
    canParticipate &&
    (dispute.status === "OPEN" || needsRationaleBackfill || Boolean(confirmedTxHash));

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

  const disputeStartIso = dispute.disputedAt ?? dispute.createdAt;
  const computedEvidenceDeadline =
    dispute.evidenceDeadlineAt ??
    new Date(Date.parse(disputeStartIso) + appConfig.escrow.evidenceSlaSeconds * 1000).toISOString();
  const computedTimeoutAt =
    dispute.timeoutAt ??
    new Date(Date.parse(disputeStartIso) + appConfig.escrow.disputeTimeoutSeconds * 1000).toISOString();

  const evidenceSla = formatDeadlineCountdown(computedEvidenceDeadline);
  const stalemateTimeout = formatDeadlineCountdown(computedTimeoutAt);
  const { maxMatches } = computeMatchingVoteStats(votes);

  const buyerHasEvidence = Boolean(
    dispute.buyer &&
      evidence?.some((e) => e.submittedBy.toLowerCase() === dispute.buyer?.toLowerCase())
  );
  const sellerHasEvidence = evidence?.some((e) => e.submittedBy.toLowerCase() === dispute.seller.toLowerCase());

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

  async function submitVoteTransaction(
    targetBuyerWei: bigint,
    targetSellerWei: bigint,
    submittedRationale?: string
  ) {
    if (inFlightRef.current) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedRationale = submittedRationale?.trim() ?? "";
    if (callerRole === "ARBITER") {
      if (trimmedRationale.length < 10) {
        setErrorMsg("Provide an arbitration rationale of at least 10 characters.");
        return;
      }
      if (trimmedRationale.length > 4000) {
        setErrorMsg("Arbitration rationale cannot exceed 4,000 characters.");
        return;
      }
    } else if (trimmedRationale.length > 4000) {
      setErrorMsg("Vote note cannot exceed 4,000 characters.");
      return;
    }

    const existingTxHash =
      confirmedTxHashRef.current ??
      (needsRationaleBackfill && dispute.resolveTxHash ? dispute.resolveTxHash : null);

    inFlightRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    try {
      let targetTxHash: `0x${string}`;
      if (existingTxHash) {
        targetTxHash = existingTxHash;
      } else if (
        pendingTx?.action === "submitResolutionVote" ||
        pendingTx?.action === "resolveDispute"
      ) {
        const recovered = await waitForHash(pendingTx.txHash);
        confirmedTxHashRef.current = recovered.txHash;
        if (mountedRef.current) {
          setConfirmedTxHash(recovered.txHash);
          setConfirmedAction("vote");
        }
        targetTxHash = recovered.txHash;
      } else {
        const tx = await executor.submitResolutionVote(
          dispute.tradeId,
          targetBuyerWei,
          targetSellerWei,
          (hash) => {
            submittedTxHash = hash;
            recoveredPendingHashRef.current = hash;
            setPending(hash, "submitResolutionVote");
          }
        );
        confirmedTxHashRef.current = tx.txHash;
        if (mountedRef.current) {
          setConfirmedTxHash(tx.txHash);
          setConfirmedAction("vote");
        }
        targetTxHash = tx.txHash;
      }

      let updated: DisputeDetail;
      if (needsRationaleBackfill) {
        updated = await recordResolution.mutateAsync({
          disputeId: dispute.id,
          txHash: targetTxHash,
          rationale: trimmedRationale,
        });
      } else {
        updated = await submitVote.mutateAsync({
          disputeId: dispute.id,
          txHash: targetTxHash,
          rationale: trimmedRationale || undefined,
        });
      }

      clearPending();
      recoveredPendingHashRef.current = null;
      confirmedTxHashRef.current = null;
      if (mountedRef.current) {
        setConfirmedTxHash(null);
        setConfirmedAction(null);
        setSuccessMsg(
          needsRationaleBackfill
            ? `Arbitration rationale recorded for settlement (${targetTxHash}).`
            : updated.status === "RESOLVED"
              ? `2-of-3 consensus reached and settled on-chain (${targetTxHash}). Beneficiaries may now withdraw.`
              : `Vote recorded on-chain (${targetTxHash}). Awaiting one matching co-signature to settle.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Resolution vote failed.";
      if (!confirmedTxHashRef.current && (!submittedTxHash || shouldClearFailedPendingTx(message))) {
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

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const existingTxHash =
      confirmedTxHashRef.current ??
      (needsRationaleBackfill && dispute.resolveTxHash ? dispute.resolveTxHash : null);

    if (
      existingTxHash ||
      pendingTx?.action === "submitResolutionVote" ||
      pendingTx?.action === "resolveDispute"
    ) {
      await submitVoteTransaction(0n, 0n, rationale);
      return;
    }

    const parsed = validateSplitAllocation(buyerAvax, sellerAvax, dispute.dealAmountWei);
    if ("error" in parsed) {
      setErrorMsg(parsed.error);
      return;
    }
    await submitVoteTransaction(parsed.buyerWei, parsed.sellerWei, rationale);
  }

  async function handleCoSignProposal(proposal: DisputeVote) {
    setBuyerAvax(formatEther(BigInt(proposal.buyerAwardWei)));
    setSellerAvax(formatEther(BigInt(proposal.sellerAwardWei)));
    const note =
      rationale.trim() ||
      (callerRole === "ARBITER"
        ? `Arbiter co-signed ${proposal.voterRole.toLowerCase()} settlement proposal after reviewing evidence.`
        : `Co-signed ${proposal.voterRole.toLowerCase()} settlement proposal.`);
    await submitVoteTransaction(BigInt(proposal.buyerAwardWei), BigInt(proposal.sellerAwardWei), note);
  }

  async function handleTimeoutFallback() {
    if (inFlightRef.current) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    inFlightRef.current = true;
    let submittedTxHash: `0x${string}` | null = null;
    try {
      let targetTxHash: `0x${string}`;
      if (confirmedTxHashRef.current && confirmedAction === "timeout") {
        targetTxHash = confirmedTxHashRef.current;
      } else if (pendingTx?.action === "resolveDisputeByTimeout") {
        const recovered = await waitForHash(pendingTx.txHash);
        confirmedTxHashRef.current = recovered.txHash;
        if (mountedRef.current) {
          setConfirmedTxHash(recovered.txHash);
          setConfirmedAction("timeout");
        }
        targetTxHash = recovered.txHash;
      } else {
        const tx = await executor.resolveDisputeByTimeout(dispute.tradeId, (hash) => {
          submittedTxHash = hash;
          recoveredPendingHashRef.current = hash;
          setPending(hash, "resolveDisputeByTimeout");
        });
        confirmedTxHashRef.current = tx.txHash;
        if (mountedRef.current) {
          setConfirmedTxHash(tx.txHash);
          setConfirmedAction("timeout");
        }
        targetTxHash = tx.txHash;
      }

      await recordTimeout.mutateAsync({
        disputeId: dispute.id,
        txHash: targetTxHash,
      });

      clearPending();
      recoveredPendingHashRef.current = null;
      confirmedTxHashRef.current = null;
      if (mountedRef.current) {
        setConfirmedTxHash(null);
        setConfirmedAction(null);
        setSuccessMsg(
          `14-day stalemate 50/50 fallback settled on-chain (${targetTxHash}). Both parties may now withdraw.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Timeout fallback failed.";
      if (!confirmedTxHashRef.current && (!submittedTxHash || shouldClearFailedPendingTx(message))) {
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

  const content = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sd-line pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-sd-accent" aria-hidden="true" />
          <h3 className="text-sm font-medium uppercase tracking-wider text-sd-inkMuted">
            2-of-3 Multi-Arbiter Consensus &amp; Timeout
          </h3>
        </div>
        <span className="rounded-full border border-sd-lineStrong bg-sd-elevated px-2.5 py-0.5 font-mono text-[11px] text-sd-ink">
          {dispute.status === "RESOLVED"
            ? "Settled"
            : `${maxMatches}/3 Matching Votes`}
        </span>
      </div>

      {/* Deadlines & SLA Strip */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-sd-line bg-sd-inset p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-sd-inkSubtle">
              <Clock size={13} aria-hidden="true" />
              7-Day Evidence SLA
            </span>
            <span
              className={`font-mono text-[11px] ${
                evidenceSla.isExpired ? "text-amber-300" : "text-sd-inkMuted"
              }`}
            >
              {evidenceSla.remainingLabel}
            </span>
          </div>
          <p className="font-mono text-xs text-white tabular-nums">{evidenceSla.formatted}</p>
          {evidence && (
            <p className="text-[11px] text-sd-inkSubtle">
              Buyer evidence: {buyerHasEvidence ? "Submitted" : "Missing"} · Seller evidence:{" "}
              {sellerHasEvidence ? "Submitted" : "Missing"}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-sd-line bg-sd-inset p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-sd-inkSubtle">
              <Clock size={13} aria-hidden="true" />
              14-Day 50/50 Stalemate Timeout
            </span>
            <span
              className={`font-mono text-[11px] ${
                stalemateTimeout.isExpired ? "text-emerald-300" : "text-sd-inkMuted"
              }`}
            >
              {stalemateTimeout.remainingLabel}
            </span>
          </div>
          <p className="font-mono text-xs text-white tabular-nums">{stalemateTimeout.formatted}</p>
          <p className="text-[11px] text-sd-inkSubtle">
            If unresolved after timeout, anyone may trigger deterministic 50/50 split.
          </p>
        </div>
      </div>

      {/* 3-Party Vote Status Grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(["BUYER", "SELLER", "ARBITER"] as const).map((role) => {
          const vote = votes.find((v) => v.voterRole === role);
          const meta = ROLE_METADATA[role];
          const onChainRoleHash = onChainVotesQuery.data
            ? role === "BUYER"
              ? onChainVotesQuery.data.buyerVoteHash
              : role === "SELLER"
                ? onChainVotesQuery.data.sellerVoteHash
                : onChainVotesQuery.data.arbiterVoteHash
            : undefined;
          const hasOnChainVoteHash = Boolean(
            typeof onChainRoleHash === "string" && onChainRoleHash.toLowerCase() !== ZERO_BYTES32
          );
          const isOnChainVoteVerified = Boolean(
            vote && hasOnChainVoteHash && onChainRoleHash?.toLowerCase() === vote.proposalHash.toLowerCase()
          );
          const isOnChainVoteMismatch = Boolean(
            vote &&
              onChainVotesQuery.isSuccess &&
              typeof onChainRoleHash === "string" &&
              onChainRoleHash.toLowerCase() !== vote.proposalHash.toLowerCase()
          );
          const canCoSign =
            Boolean(vote) &&
            !isOnChainVoteMismatch &&
            dispute.status === "OPEN" &&
            callerRole !== null &&
            callerRole !== role &&
            myVote?.proposalHash.toLowerCase() !== vote?.proposalHash.toLowerCase();

          return (
            <div
              key={role}
              className={`rounded-xl border p-3.5 space-y-2 ${
                vote ? "border-sd-lineStrong bg-sd-elevated/50" : "border-sd-line bg-sd-inset/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] ${meta.badgeClass}`}
                >
                  {meta.label}
                </span>
                {vote ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-300">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    Voted
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-sd-inkSubtle">Pending</span>
                )}
              </div>

              {vote ? (
                <div className="space-y-1.5 text-xs">
                  <p className="font-mono text-white tabular-nums">
                    Buyer: {formatAvax(vote.buyerAwardWei)}
                  </p>
                  <p className="font-mono text-white tabular-nums">
                    Seller: {formatAvax(vote.sellerAwardWei)}
                  </p>
                  {isOnChainVoteVerified && (
                    <p className="inline-flex flex-wrap items-center gap-1 font-mono text-[11px] text-emerald-300">
                      <ShieldCheck size={11} aria-hidden="true" />
                      <span>On-chain vote hash verified</span>
                    </p>
                  )}
                  {isOnChainVoteMismatch && (
                    <p className="font-mono text-[11px] text-rose-300">
                      On-chain vote hash mismatch — verify contract state
                    </p>
                  )}
                  {vote.rationale && (
                    <p className="line-clamp-2 text-[11px] text-sd-inkMuted">{vote.rationale}</p>
                  )}
                  <CopyableHash
                    value={vote.txHash}
                    displayValue={shortenAddress(vote.txHash, 6)}
                    label={`${meta.label} vote tx`}
                    className="text-[11px]"
                  />
                  {canCoSign && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="mt-1 w-full"
                      disabled={
                        Boolean(executor.activeAction) ||
                        Boolean(activeResolveTxHash) ||
                        isRecoveringPending ||
                        submitVote.isPending ||
                        recordResolution.isPending ||
                        recordTimeout.isPending
                      }
                      onClick={() => void handleCoSignProposal(vote)}
                    >
                      Co-sign to Finalize (2/3)
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[11px] text-sd-inkSubtle">
                    No settlement proposal signed yet.
                  </p>
                  {hasOnChainVoteHash && onChainRoleHash && (
                    <p className="font-mono text-[11px] text-amber-300">
                      On-chain vote hash recorded ({shortenAddress(onChainRoleHash, 6)})
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {errorMsg && <AlertBanner tone="error" message={errorMsg} />}
      {successMsg && <AlertBanner tone="success" message={successMsg} />}
      {!successMsg && activeResolveTxHash && showVotingForm && (
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="tabular-nums">
              Buyer Award:{" "}
              <span className="font-mono text-white">{formatAvax(dispute.buyerAwardWei ?? "0")}</span>{" "}
              · Seller Award:{" "}
              <span className="font-mono text-white">{formatAvax(dispute.sellerAwardWei ?? "0")}</span>
            </p>
            <StatusBadge status={dispute.status} />
          </div>
          <p className="leading-relaxed text-sd-inkMuted">Rationale: {dispute.resolutionRationale}</p>
        </div>
      )}

      {dispute.status === "OPEN" && stalemateTimeout.isExpired && canParticipate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/35 bg-emerald-500/10 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-emerald-200">
              14-Day Stalemate Timeout Reached
            </p>
            <p className="text-xs text-sd-inkMuted">
              Consensus was not reached within 14 days. Execute the deterministic 50/50 split fallback to release funds safely.
            </p>
          </div>
          <Button
            type="button"
            disabled={
              Boolean(executor.activeAction) || isRecoveringPending || recordTimeout.isPending
            }
            onClick={() => void handleTimeoutFallback()}
          >
            {executor.activeAction === "resolveDisputeByTimeout"
              ? "Approve in Wallet..."
              : recordTimeout.isPending
                ? "Recording Timeout..."
                : "Execute 50/50 Timeout Fallback"}
          </Button>
        </div>
      )}

      {showVotingForm && (
        <form onSubmit={handleFormSubmit} className="space-y-4 border-t border-sd-line pt-5">
          <div className="rounded-xl border border-sd-line bg-sd-inset p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-sd-ink">
                {callerRole === "ARBITER"
                  ? "Split Allocation"
                  : "Propose / Vote Settlement Split"}
              </span>
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
              role="img"
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
              {callerRole === "ARBITER"
                ? "Arbitration Rationale"
                : "Proposal Note (optional)"}
            </label>
            <textarea
              id={`rationale-${dispute.id}`}
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={
                callerRole === "ARBITER"
                  ? "Document the evidence review and settlement rationale"
                  : "Optionally explain your proposed split for the counterparty or arbiter"
              }
              className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none"
            />
          </div>

          <Button
            type="submit"
            disabled={
              Boolean(executor.activeAction) ||
              isRecoveringPending ||
              submitVote.isPending ||
              recordResolution.isPending
            }
          >
            {executor.activeAction === "submitResolutionVote"
              ? "Approve in Wallet..."
              : isRecoveringPending
                ? "Checking Settlement Tx..."
                : submitVote.isPending || recordResolution.isPending
                  ? "Recording Vote..."
                  : activeResolveTxHash
                    ? needsRationaleBackfill
                      ? "Save Arbitration Rationale"
                      : "Retry Recording Settlement"
                    : "Sign & Submit Settlement On-Chain"}
          </Button>
        </form>
      )}
    </div>
  );

  if (variant === "embedded") {
    return content;
  }

  return <Panel className="space-y-5">{content}</Panel>;
}
