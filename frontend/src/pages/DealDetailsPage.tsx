import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { zeroAddress } from "viem";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { DealLifecycleStepper } from "@/components/ui/DealLifecycleStepper";
import { contractsConfig } from "@/config/contracts";
import { env } from "@/config/env";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/config/network.config";
import { disputePath, ROUTES } from "@/config/routes";
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
import { evaluateArbiterTrust, formatAvax, formatDurationSeconds, formatTimestamp } from "@/utils/format";

function resolveExplorerContractUrl(contractAddress: string | null | undefined): string | null {
  if (!contractAddress) return null;
  const configured = getExplorerAddressUrl(contractAddress);
  if (configured) return configured;
  if (env.chainId === 43113) return `https://testnet.snowtrace.io/address/${contractAddress}`;
  if (env.chainId === 43114) return `https://snowtrace.io/address/${contractAddress}`;
  return null;
}

function ArbiterTrustShield({ arbiterAddress }: { readonly arbiterAddress: string }) {
  const trust = evaluateArbiterTrust(arbiterAddress, env.defaultArbiterAddress);
  if (trust === "none") return null;
  if (trust === "verified") {
    return (
      <span className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] leading-snug text-emerald-200">
        <ShieldCheck size={12} className="shrink-0 text-emerald-300" aria-hidden="true" />
        <span>Verified Neutral Arbiter</span>
      </span>
    );
  }
  return (
    <span className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-1 font-mono text-[11px] leading-snug text-amber-200">
      <AlertTriangle size={12} className="shrink-0 text-amber-300" aria-hidden="true" />
      <span>Custom External Arbiter (Verify Neutrality — 2-of-3 Consensus Power)</span>
    </span>
  );
}

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

  const { address, isConnected, isWrongNetwork, isAuthenticated, isSessionLoading, openWalletModal, signInWithWallet } = useAuthSession();
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
  const [termsHashError, setTermsHashError] = useState(false);
  const [isRecoveringPending, setIsRecoveringPending] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSummary, setDisputeSummary] = useState("");
  const [showDisputeForm, setShowDisputeForm] = useState(false);

  const deal = dealQuery.data;

  const { waitForHash, clearTxError } = executor;
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
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 5_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    recoveredPendingHashRef.current = null;
    setActionError(null);
    setActionSuccess(null);
    clearTxError();
  }, [address, clearTxError, tradeId]);

  const pendingTxHash = pendingTx?.txHash ?? null;
  const pendingTxAction = pendingTx?.action ?? null;

  // Resume pending tx waiting only after browser reload (never duplicate active in-mount submissions)
  useEffect(() => {
    if (!pendingTxHash || !pendingTxAction) {
      recoveredPendingHashRef.current = null;
      return;
    }
    if (!tradeId || !isConnected || isWrongNetwork || !isAuthenticated) return;
    if (inFlightActionRef.current || recoveredPendingHashRef.current === pendingTxHash) return;

    let cancelled = false;
    recoveredPendingHashRef.current = pendingTxHash;
    const targetTxHash = pendingTxHash;
    const targetAction = pendingTxAction;
    setIsRecoveringPending(true);

    void (async () => {
      try {
        const result = await waitForHash(targetTxHash);
        if (cancelled || !mountedRef.current) return;

        if (targetAction === "createTrade") {
          await bindDealTxAsync({ tradeId, txHash: result.txHash });
        } else if (targetAction !== "withdraw") {
          await syncDealAsync({ tradeId, txHash: result.txHash });
        }

        if (cancelled || !mountedRef.current) return;
        await Promise.all([refetchOnChainRef.current(), refetchClaimableRef.current()]);
        clearPending();
        recoveredPendingHashRef.current = null;
        if (!cancelled && mountedRef.current) {
          setActionSuccess(`Pending ${targetAction} transaction confirmed (${result.txHash}).`);
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Pending transaction failed.";
        if (shouldClearFailedPendingTx(message)) {
          clearPending();
          recoveredPendingHashRef.current = null;
        } else {
          recoveredPendingHashRef.current = null;
        }
        setActionError(message);
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
    bindDealTxAsync,
    clearPending,
    isAuthenticated,
    isConnected,
    isWrongNetwork,
    pendingTxAction,
    pendingTxHash,
    syncDealAsync,
    tradeId,
    waitForHash,
  ]);

  // Verify terms hash client-side against deal parameters
  useEffect(() => {
    if (!deal) return;
    let active = true;
    setVerifiedTermsHash(null);
    setTermsHashError(false);

    let canonicalBuyer = deal.buyer;
    if (deal.canonicalTermsJson) {
      try {
        const parsed = JSON.parse(deal.canonicalTermsJson) as { buyer?: string | null };
        if (parsed && parsed.buyer === null) {
          canonicalBuyer = null;
        }
      } catch {
        // Fallback to deal.buyer if canonicalTermsJson is not valid JSON
      }
    }

    void computeCanonicalTermsHash({
      version: 1,
      chainId: deal.chainId,
      seller: deal.seller,
      buyer: canonicalBuyer,
      arbiter: deal.arbiter,
      amountWei: deal.amountWei,
      fundingDeadline: Math.floor(Date.parse(deal.fundingDeadline) / 1000),
      deliveryDeadline: Math.floor(Date.parse(deal.deliveryDeadline) / 1000),
      inspectionWindowSeconds: deal.inspectionWindowSeconds,
      title: deal.title,
      description: deal.description,
      terms: deal.terms,
    })
      .then((res) => {
        if (active) setVerifiedTermsHash(res.termsHash);
      })
      .catch(() => {
        if (active) setTermsHashError(true);
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

  const onChainBuyer =
    onChainQuery.data?.buyer && onChainQuery.data.buyer.toLowerCase() !== zeroAddress
      ? onChainQuery.data.buyer
      : null;
  const effectiveBuyer = deal?.buyer ?? onChainBuyer;

  const me = address?.toLowerCase();
  const isSeller = Boolean(me && deal && deal.seller.toLowerCase() === me);
  const isBuyer = Boolean(me && effectiveBuyer && effectiveBuyer.toLowerCase() === me);
  const isArbiter = Boolean(me && deal && deal.arbiter.toLowerCase() === me);
  const isOpenBuyerEligible = Boolean(
    me && deal && !effectiveBuyer && !isSeller && !isArbiter
  );

  const fundingDeadlineEpoch = deal ? Math.floor(Date.parse(deal.fundingDeadline) / 1000) : 0;
  const deliveryDeadlineEpoch = deal ? Math.floor(Date.parse(deal.deliveryDeadline) / 1000) : 0;
  const onChainDeliveredAtEpoch = onChainQuery.data ? Number(onChainQuery.data.deliveredAt) : 0;
  const deliveredAtEpoch =
    onChainDeliveredAtEpoch > 0
      ? onChainDeliveredAtEpoch
      : deal?.deliveredAt
        ? Math.floor(Date.parse(deal.deliveredAt) / 1000)
        : 0;
  const sellerDisputeUnlockEpoch = deal ? deliveredAtEpoch + deal.inspectionWindowSeconds : 0;

  const termsHashVerified = useMemo(() => {
    if (!deal || !verifiedTermsHash) return false;
    return verifiedTermsHash.toLowerCase() === deal.termsHash.toLowerCase();
  }, [deal, verifiedTermsHash]);
  const termsHashMismatch = Boolean((verifiedTermsHash && !termsHashVerified) || termsHashError);

  const onChainData = onChainQuery.data as
    | {
        readonly seller?: `0x${string}`;
        readonly buyer?: `0x${string}`;
        readonly arbiter?: `0x${string}`;
        readonly amount?: bigint;
        readonly termsHash?: `0x${string}`;
        readonly status: number;
        readonly deliveredAt?: bigint;
      }
    | undefined;

  const onChainTermsHashMatch = useMemo(() => {
    if (!deal || deal.status === "DRAFT" || !onChainStatus || onChainStatus === "NONE") return null;
    if (!onChainData || typeof onChainData.termsHash !== "string") return null;
    return onChainData.termsHash.toLowerCase() === deal.termsHash.toLowerCase();
  }, [deal, onChainData, onChainStatus]);

  const onChainAmountMatch = useMemo(() => {
    if (!deal || deal.status === "DRAFT" || !onChainStatus || onChainStatus === "NONE") return null;
    if (!onChainData || onChainData.amount === undefined) return null;
    try {
      return BigInt(onChainData.amount) === BigInt(deal.amountWei);
    } catch {
      return false;
    }
  }, [deal, onChainData, onChainStatus]);

  const onChainPartiesMatch = useMemo(() => {
    if (!deal || deal.status === "DRAFT" || !onChainStatus || onChainStatus === "NONE") return null;
    if (!onChainData || typeof onChainData.seller !== "string" || typeof onChainData.arbiter !== "string") {
      return null;
    }
    const sellerMatches = onChainData.seller.toLowerCase() === deal.seller.toLowerCase();
    const arbiterMatches = onChainData.arbiter.toLowerCase() === deal.arbiter.toLowerCase();
    const buyerMatches =
      deal.buyer && onChainBuyer ? onChainBuyer.toLowerCase() === deal.buyer.toLowerCase() : true;
    return sellerMatches && arbiterMatches && buyerMatches;
  }, [deal, onChainBuyer, onChainData, onChainStatus]);

  const onChainIntegrityMismatch = Boolean(
    deal &&
      deal.status !== "DRAFT" &&
      onChainStatus &&
      onChainStatus !== "NONE" &&
      (onChainTermsHashMatch === false || onChainAmountMatch === false || onChainPartiesMatch === false)
  );

  const unverifiedOnChainEscrow = Boolean(
    deal &&
      (deal.status === "FUNDED" || deal.status === "DELIVERED" || deal.status === "DISPUTED") &&
      onChainQuery.isSuccess &&
      onChainStatus === "NONE"
  );

  const isThreeWayVerified = Boolean(
    termsHashVerified &&
      onChainStatus &&
      onChainStatus !== "NONE" &&
      onChainTermsHashMatch === true &&
      onChainAmountMatch === true &&
      onChainPartiesMatch !== false
  );

  const actionsBlockedByIntegrity = onChainIntegrityMismatch || unverifiedOnChainEscrow;

  const hasPublicOnChainRecord = Boolean(
    onChainData &&
      onChainStatus &&
      onChainStatus !== "NONE" &&
      typeof onChainData.seller === "string" &&
      typeof onChainData.arbiter === "string" &&
      typeof onChainData.termsHash === "string" &&
      onChainData.amount !== undefined
  );
  const publicContractExplorerUrl = resolveExplorerContractUrl(contractsConfig.escrowAddress);

  function renderPublicOnChainPanel() {
    if (
      !hasPublicOnChainRecord ||
      !onChainData ||
      !onChainStatus ||
      onChainStatus === "NONE" ||
      typeof onChainData.seller !== "string" ||
      typeof onChainData.arbiter !== "string" ||
      typeof onChainData.termsHash !== "string" ||
      onChainData.amount === undefined
    ) {
      return null;
    }

    return (
      <Panel variant="elevated" className="mt-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sd-line pb-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-300" aria-hidden="true" />
              <h2 className="text-base font-medium text-white">Live On-Chain Contract Verification</h2>
            </div>
            <p className="mt-0.5 text-xs text-sd-inkMuted">
              Read directly from Avalanche SafeDealEscrow via JSON-RPC without requiring a wallet session.
            </p>
          </div>
          <StatusBadge status={onChainStatus} />
        </div>

        <dl className="grid gap-4 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-sd-line bg-sd-inset p-3.5">
            <dt className="text-sd-inkSubtle">Locked Escrow Amount</dt>
            <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-white">
              {formatAvax(onChainData.amount)}
            </dd>
          </div>
          <div className="rounded-lg border border-sd-line bg-sd-inset p-3.5">
            <dt className="text-sd-inkSubtle">On-Chain Terms Hash</dt>
            <dd className="mt-1">
              <CopyableHash value={onChainData.termsHash} label="On-Chain Terms Hash" className="w-full text-xs" />
            </dd>
          </div>
          <div className="rounded-lg border border-sd-line bg-sd-inset p-3.5">
            <dt className="text-sd-inkSubtle">Seller</dt>
            <dd className="mt-1">
              <CopyableHash value={onChainData.seller} label="On-Chain Seller" className="w-full text-xs" />
            </dd>
          </div>
          <div className="rounded-lg border border-sd-line bg-sd-inset p-3.5">
            <dt className="text-sd-inkSubtle">Buyer</dt>
            <dd className="mt-1">
              {onChainBuyer ? (
                <CopyableHash value={onChainBuyer} label="On-Chain Buyer" className="w-full text-xs" />
              ) : (
                <span className="font-mono text-sd-ink">Open (any eligible buyer)</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-sd-line bg-sd-inset p-3.5 sm:col-span-2">
            <dt className="text-sd-inkSubtle">Human Arbiter</dt>
            <dd className="mt-1 flex flex-col items-start">
              <CopyableHash value={onChainData.arbiter} label="On-Chain Arbiter" className="w-full text-xs" />
              <ArbiterTrustShield arbiterAddress={onChainData.arbiter} />
            </dd>
          </div>
        </dl>

        {contractsConfig.escrowAddress && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sd-line pt-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sd-inkSubtle">Escrow Contract:</span>
              <CopyableHash value={contractsConfig.escrowAddress} label="Escrow Contract" className="text-xs" />
            </div>
            {publicContractExplorerUrl && (
              <a
                href={publicContractExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-emerald-300 underline hover:text-emerald-200"
              >
                <span>Verify on Snowtrace</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </Panel>
    );
  }

  async function runAndSync(
    actionName: string,
    fn: (onHash: (hash: `0x${string}`) => void) => Promise<{ txHash: `0x${string}` }>
  ) {
    if (!tradeId || inFlightActionRef.current || actionsBlockedByIntegrity) return;
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
    if (inFlightActionRef.current) return;
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
    clearTxError();
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
    clearTxError();
    const trimmedReason = disputeReason.trim();
    const trimmedSummary = disputeSummary.trim();
    if (trimmedReason.length < 5 || trimmedSummary.length < 10) {
      setActionError("Enter a clear dispute reason (5+ chars) and summary (10+ chars).");
      return;
    }
    if (trimmedReason.length > 200 || trimmedSummary.length > 4000) {
      setActionError("Dispute reason (max 200 chars) or summary (max 4,000 chars) is too long.");
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
      }
      const dispute = await createDisputeMutation.mutateAsync({
        tradeId,
        reason: trimmedReason,
        summary: trimmedSummary,
        txHash,
      });
      clearPending();
      recoveredPendingHashRef.current = null;
      if (mountedRef.current) {
        navigate(disputePath(String(dispute.id)));
      }
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
      breadcrumb={{ label: "My Deals", to: ROUTES.dashboard }}
    >
      {!isConnected ? (
        <>
          <EmptyState
            title="Connect wallet to inspect deal"
            description="Connect your wallet and sign in to view verified terms, on-chain status, and available escrow actions."
            action={<Button onClick={openWalletModal}>Connect Wallet</Button>}
          />
          {renderPublicOnChainPanel()}
        </>
      ) : isSessionLoading ? (
        <LoadingState label="Restoring wallet session..." />
      ) : !isAuthenticated ? (
        <>
          <EmptyState
            title="Sign in required"
            description="Authenticate your wallet session via SIWE to load this deal."
            action={<Button onClick={() => void signInWithWallet()}>Sign In with Wallet</Button>}
          />
          {renderPublicOnChainPanel()}
        </>
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
          {onChainIntegrityMismatch && (
            <AlertBanner
              tone="error"
              title="On-Chain Integrity Mismatch — Actions Blocked"
              message="Off-chain deal metadata (termsHash, amountWei, or participant addresses) does not match the SafeDealEscrow record on Avalanche. All escrow actions are blocked to protect your funds."
            />
          )}
          {unverifiedOnChainEscrow && (
            <AlertBanner
              tone="error"
              title="Unverified On-Chain Escrow"
              message="Backend reports this deal as active, but SafeDealEscrow on-chain returned status NONE (not funded on-chain). Do NOT deliver goods or release services until verified on Snowtrace."
            />
          )}
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

          <DealLifecycleStepper
            status={effectiveStatus ?? deal.status}
            deliveredAt={deal.deliveredAt}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sd-line pb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <StatusBadge status={deal.status} />
                    {onChainStatus && onChainStatus !== deal.status && (
                      <span className="text-xs text-amber-300">
                        On-chain state: {onChainStatus} (sync recommended)
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-sd-inkSubtle">
                    <span>Trade ID:</span>
                    <CopyableHash value={deal.tradeId} label="Trade ID" className="text-xs" />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-sd-inkMuted">{deal.description}</p>
                </div>

                <Button
                  size="sm"
                  variant="secondary"
                  disabled={syncMutation.isPending}
                  onClick={() => void handleManualSync()}
                >
                  <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} aria-hidden="true" />
                  <span>{syncMutation.isPending ? "Syncing..." : "Sync On-Chain"}</span>
                </Button>
              </div>

              <div>
                <h2 className="text-sm font-medium text-white">Agreed Terms &amp; Acceptance Criteria</h2>
                <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-sd-line bg-sd-inset p-4 font-geist text-sm leading-relaxed text-sd-ink">
                  {deal.terms}
                </pre>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-sd-inkMuted">
                  <span>Canonical Terms Hash:</span>
                  <CopyableHash value={deal.termsHash} label="Terms Hash" className="text-xs" />
                  {termsHashVerified ? (
                    <span className="text-emerald-300">(client SHA-256 verified)</span>
                  ) : termsHashMismatch ? (
                    <span className="text-rose-300">(terms hash mismatch!)</span>
                  ) : (
                    <span className="text-amber-300">(verifying...)</span>
                  )}
                  {isThreeWayVerified && (
                    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-200">
                      <ShieldCheck size={12} className="shrink-0 text-emerald-300" aria-hidden="true" />
                      <span>3-Way Verified (Browser SHA-256 = API = Avalanche Contract)</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t border-sd-line pt-5">
                <h2 className="text-sm font-medium text-white">Available Actions</h2>

                <div className="flex flex-wrap gap-3">
                  {effectiveStatus === "DRAFT" && isSeller && (
                    <Button
                      disabled={
                        Boolean(executor.activeAction) ||
                        syncMutation.isPending ||
                        bindTxMutation.isPending ||
                        actionsBlockedByIntegrity
                      }
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
                      disabled={
                        Boolean(executor.activeAction) ||
                        isRecoveringPending ||
                        syncMutation.isPending ||
                        bindTxMutation.isPending ||
                        termsHashMismatch ||
                        actionsBlockedByIntegrity
                      }
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
                      disabled={
                        Boolean(executor.activeAction) ||
                        syncMutation.isPending ||
                        bindTxMutation.isPending ||
                        actionsBlockedByIntegrity
                      }
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
                      {nowSeconds <= deliveryDeadlineEpoch && (
                        <Button
                          disabled={
                            Boolean(executor.activeAction) ||
                            isRecoveringPending ||
                            syncMutation.isPending ||
                            bindTxMutation.isPending ||
                            actionsBlockedByIntegrity
                          }
                          onClick={() =>
                            void runAndSync("markDelivered", (onHash) =>
                              executor.markDelivered(deal.tradeId, onHash)
                            )
                          }
                        >
                          Mark Delivered
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        disabled={
                          Boolean(executor.activeAction) ||
                          isRecoveringPending ||
                          syncMutation.isPending ||
                          bindTxMutation.isPending ||
                          actionsBlockedByIntegrity
                        }
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
                      disabled={
                        Boolean(executor.activeAction) ||
                        syncMutation.isPending ||
                        bindTxMutation.isPending ||
                        actionsBlockedByIntegrity
                      }
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
                      disabled={
                        Boolean(executor.activeAction) ||
                        syncMutation.isPending ||
                        bindTxMutation.isPending ||
                        actionsBlockedByIntegrity
                      }
                      onClick={() =>
                        void runAndSync("releaseFunds", (onHash) =>
                          executor.releaseFunds(deal.tradeId, onHash)
                        )
                      }
                    >
                      Approve &amp; Release Funds
                    </Button>
                  )}

                  {((effectiveStatus === "FUNDED" && (isBuyer || isSeller)) ||
                    (effectiveStatus === "DELIVERED" &&
                      (isBuyer || (isSeller && deliveredAtEpoch > 0 && nowSeconds > sellerDisputeUnlockEpoch)))) && (
                    <Button
                      variant="danger"
                      disabled={
                        Boolean(executor.activeAction) ||
                        syncMutation.isPending ||
                        createDisputeMutation.isPending ||
                        actionsBlockedByIntegrity
                      }
                      onClick={() => setShowDisputeForm((v) => !v)}
                    >
                      <ShieldAlert size={15} />
                      <span>Open Dispute</span>
                    </Button>
                  )}

                  {deal.disputeId && (
                    <Link
                      to={disputePath(String(deal.disputeId))}
                      className="inline-flex min-h-[40px] items-center rounded-lg border border-sd-lineStrong px-4 py-2 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10"
                    >
                      Open Dispute Center
                    </Link>
                  )}

                  {effectiveStatus === "DISPUTED" && !deal.disputeId && (isBuyer || isSeller) && (
                    <Button
                      variant="secondary"
                      disabled={actionsBlockedByIntegrity}
                      onClick={() => setShowDisputeForm(true)}
                    >
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
                      className="w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none focus:ring-1 focus:ring-sd-accent/40"
                    />
                    <textarea
                      rows={3}
                      value={disputeSummary}
                      onChange={(e) => setDisputeSummary(e.target.value)}
                      placeholder="Explain the dispute facts for the arbiter"
                      className="w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none focus:ring-1 focus:ring-sd-accent/40"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="danger"
                        size="sm"
                        disabled={
                          Boolean(executor.activeAction) ||
                          createDisputeMutation.isPending ||
                          syncMutation.isPending ||
                          actionsBlockedByIntegrity
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

            <Panel variant="inset" className="space-y-4">
              <h2 className="text-base font-medium text-white">Escrow Parameters</h2>
              <dl className="space-y-3 text-xs">
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Escrow Value</dt>
                  <dd className="mt-1 font-mono text-base font-semibold tabular-nums text-white">
                    {formatAvax(deal.amountWei)}
                  </dd>
                </div>
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Seller</dt>
                  <dd className="mt-1 font-mono break-all text-sd-ink">{deal.seller}</dd>
                </div>
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Buyer</dt>
                  <dd className="mt-1 font-mono break-all text-sd-ink">
                    {deal.buyer ?? "Open (any eligible buyer)"}
                  </dd>
                </div>
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Human Arbiter</dt>
                  <dd className="mt-1 flex flex-col items-start">
                    <span className="font-mono break-all text-sd-ink">{deal.arbiter}</span>
                    <ArbiterTrustShield arbiterAddress={deal.arbiter} />
                  </dd>
                </div>
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Funding Deadline</dt>
                  <dd className="mt-1 tabular-nums text-sd-ink">{formatTimestamp(deal.fundingDeadline)}</dd>
                </div>
                <div className="border-b border-sd-line pb-2.5">
                  <dt className="text-sd-inkSubtle">Delivery Deadline</dt>
                  <dd className="mt-1 tabular-nums text-sd-ink">{formatTimestamp(deal.deliveryDeadline)}</dd>
                </div>
                <div>
                  <dt className="text-sd-inkSubtle">Inspection Window</dt>
                  <dd className="mt-1 tabular-nums text-sd-ink">
                    {formatDurationSeconds(deal.inspectionWindowSeconds)}
                  </dd>
                </div>
              </dl>

              {deal.contractAddress && (
                <div className="border-t border-sd-line pt-3 text-xs">
                  <p className="text-sd-inkSubtle">Contract Address</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CopyableHash
                      value={deal.contractAddress}
                      label="Contract Address"
                      className="max-w-full text-xs"
                    />
                    {getExplorerAddressUrl(deal.contractAddress) && (
                      <a
                        href={getExplorerAddressUrl(deal.contractAddress)!}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View contract on block explorer"
                        className="inline-flex items-center gap-1 text-sd-inkMuted underline hover:text-white"
                      >
                        <span>Explorer</span>
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <Panel className="space-y-4">
            <h2 className="text-base font-medium text-white">Verified Timeline &amp; Transactions</h2>
            {historyQuery.isLoading ? (
              <p className="text-sm text-sd-inkMuted">Loading timeline...</p>
            ) : historyQuery.isError ? (
              <p className="text-sm text-rose-300">Failed to load timeline events.</p>
            ) : !historyQuery.data || historyQuery.data.events.length === 0 ? (
              <p className="text-sm text-sd-inkMuted">No verified events recorded yet.</p>
            ) : (
              <ol className="relative ml-2 border-l border-sd-lineStrong pl-5 space-y-4">
                {historyQuery.data.events.map((event) => {
                  const txUrl = event.txHash ? getExplorerTxUrl(event.txHash) : null;
                  return (
                    <li key={event.id} className="relative">
                      <span
                        className="absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border border-emerald-400/70 bg-sd-canvas ring-4 ring-sd-surface"
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-sd-line bg-sd-inset p-3.5 text-xs">
                        <div className="space-y-1">
                          <p className="font-mono font-medium text-white">{event.eventType}</p>
                          <p className="text-sd-inkMuted">{event.details}</p>
                        </div>
                        <div className="text-left sm:text-right text-sd-inkMuted">
                          <p className="tabular-nums">{formatTimestamp(event.createdAt)}</p>
                          {event.txHash && (
                            <p className="mt-1 font-mono tabular-nums">
                              {txUrl ? (
                                <a
                                  href={txUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 underline hover:text-white"
                                >
                                  <span>{event.txHash.slice(0, 12)}...</span>
                                  <ExternalLink size={10} aria-hidden="true" />
                                </a>
                              ) : (
                                `${event.txHash.slice(0, 14)}...`
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
