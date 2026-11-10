import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { zeroAddress } from "viem";
import { ArrowRight, Check, Copy } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, Panel } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { appConfig } from "@/config/app.config";
import { env } from "@/config/env";
import { dealPath } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import { useBindDealTxMutation, useCreateDealDraftMutation } from "@/features/deals/hooks/useDeals";
import { useCreateDraftPersistence } from "@/features/deals/hooks/useCreateDraftPersistence";
import { usePendingTxPersistence } from "@/features/deals/hooks/usePendingTransactions";
import {
  createDealSchema,
  type CreateDealFormValues,
} from "@/features/deals/schemas/create-deal.schema";
import { useEscrowContractExecutor } from "@/features/escrow/hooks/useEscrowActions";
import type { CreateDealDraftResponse } from "@/types/api";
import { computeCanonicalTermsHash } from "@/utils/canonical-terms";
import { parseAvaxToWei } from "@/utils/format";

function toLocalDateTimeInput(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateDealPage() {
  const navigate = useNavigate();
  const {
    address,
    isConnected,
    isWrongNetwork,
    isAuthenticated,
    openWalletModal,
    signInWithWallet,
  } = useAuthSession();

  const createDraftMutation = useCreateDealDraftMutation();
  const bindTxMutation = useBindDealTxMutation();
  const { mutateAsync: bindDealTxAsync } = bindTxMutation;
  const { createTrade, waitForHash, activeAction, txError } = useEscrowContractExecutor();
  const { persistedDraft, persistDraftState, clearDraftState } = useCreateDraftPersistence(address);

  const [previewDraft, setPreviewDraft] = useState<CreateDealDraftResponse | null>(
    () => persistedDraft?.previewDraft ?? null
  );
  const [clientTermsHash, setClientTermsHash] = useState<`0x${string}` | null>(
    () => persistedDraft?.clientTermsHash ?? null
  );
  const [createdTradeId, setCreatedTradeId] = useState<`0x${string}` | null>(null);
  const [submittedCreateTxHash, setSubmittedCreateTxHash] = useState<`0x${string}` | null>(
    () => persistedDraft?.submittedCreateTxHash ?? null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRecoveringPending, setIsRecoveringPending] = useState(false);

  const mountedRef = useRef(true);
  const inFlightSubmitRef = useRef(false);
  const recoveredPendingHashRef = useRef<string | null>(null);
  const lastConnectedSellerRef = useRef<string | undefined>(address?.toLowerCase());
  const submittedCreateTxHashRef = useRef<`0x${string}` | null>(submittedCreateTxHash);
  submittedCreateTxHashRef.current = submittedCreateTxHash;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { pendingTx, setPending, clearPending } = usePendingTxPersistence(
    previewDraft ? `create-${previewDraft.tradeId}` : "create-draft"
  );
  const confirmedOrPendingCreateTxHash =
    submittedCreateTxHash ?? (pendingTx?.action === "createTrade" ? pendingTx.txHash : null);

  const defaultInspectionHours = Math.max(1, Math.round(appConfig.escrow.defaultInspectionWindowSeconds / 3600));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDealFormValues>({
    resolver: zodResolver(createDealSchema),
    defaultValues: {
      title: "",
      description: "",
      amountAvax: "0.5",
      buyerAddress: "",
      arbiterAddress: env.defaultArbiterAddress ?? "",
      fundingDeadline: toLocalDateTimeInput(24),
      deliveryDeadline: toLocalDateTimeInput(168),
      inspectionHours: defaultInspectionHours,
      terms: "",
    },
  });

  useEffect(() => {
    setSubmitError(null);
    const currentScope = address?.toLowerCase();
    if (!currentScope) {
      setCreatedTradeId(null);
      setPreviewDraft(null);
      setClientTermsHash(null);
      setSubmittedCreateTxHash(null);
      recoveredPendingHashRef.current = null;
      return;
    }
    const prevConnectedScope = lastConnectedSellerRef.current;
    if (prevConnectedScope && prevConnectedScope !== currentScope) {
      setCreatedTradeId(null);
      setPreviewDraft(null);
      setClientTermsHash(null);
      setSubmittedCreateTxHash(null);
      recoveredPendingHashRef.current = null;
    }
    lastConnectedSellerRef.current = currentScope;
  }, [address]);

  useEffect(() => {
    if (
      !persistedDraft ||
      !address ||
      persistedDraft.sellerAddress.toLowerCase() !== address.toLowerCase()
    ) {
      return;
    }
    setPreviewDraft((prev) =>
      prev?.tradeId === persistedDraft.previewDraft.tradeId ? prev : persistedDraft.previewDraft
    );
    setClientTermsHash(persistedDraft.clientTermsHash);
    setSubmittedCreateTxHash((prev) => prev ?? persistedDraft.submittedCreateTxHash ?? null);
  }, [address, persistedDraft]);

  // Recover an in-flight createTrade transaction after browser reload without re-invoking createTrade
  useEffect(() => {
    if (!previewDraft || !pendingTx || pendingTx.action !== "createTrade") return;
    if (submittedCreateTxHashRef.current || createdTradeId) return;
    if (!isConnected || isWrongNetwork || !isAuthenticated) return;
    if (inFlightSubmitRef.current || recoveredPendingHashRef.current === pendingTx.txHash) return;

    recoveredPendingHashRef.current = pendingTx.txHash;
    const targetDraft = previewDraft;
    const effectiveTermsHash = clientTermsHash ?? targetDraft.termsHash;
    setIsRecoveringPending(true);
    setSubmitError(null);

    void (async () => {
      try {
        const recovered = await waitForHash(pendingTx.txHash);
        if (!mountedRef.current) return;
        setSubmittedCreateTxHash(recovered.txHash);
        persistDraftState({
          previewDraft: targetDraft,
          clientTermsHash: effectiveTermsHash,
          submittedCreateTxHash: recovered.txHash,
        });

        await bindDealTxAsync({
          tradeId: targetDraft.tradeId,
          txHash: recovered.txHash,
        });
        if (!mountedRef.current) return;

        clearPending();
        clearDraftState();
        setSubmittedCreateTxHash(null);
        setCreatedTradeId(targetDraft.tradeId);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : "Failed to recover pending create transaction.";
        if (!submittedCreateTxHashRef.current && message.includes("reverted on-chain")) {
          clearPending();
        }
        setSubmitError(message);
      } finally {
        if (mountedRef.current) {
          setIsRecoveringPending(false);
        }
      }
    })();
  }, [
    bindDealTxAsync,
    clearDraftState,
    clearPending,
    clientTermsHash,
    createdTradeId,
    isAuthenticated,
    isConnected,
    isWrongNetwork,
    pendingTx,
    persistDraftState,
    previewDraft,
    waitForHash,
  ]);

  const shareUrl = useMemo(() => {
    if (!createdTradeId || typeof window === "undefined") return "";
    return `${window.location.origin}${dealPath(createdTradeId)}`;
  }, [createdTradeId]);

  async function onDraftPreview(values: CreateDealFormValues) {
    setSubmitError(null);
    if (!isConnected || !address) {
      openWalletModal();
      return;
    }
    if (isWrongNetwork) {
      setSubmitError(appConfig.messages.wrongNetwork);
      return;
    }
    if (!isAuthenticated) {
      const signed = await signInWithWallet();
      if (!signed) return;
    }

    const amountWei = parseAvaxToWei(values.amountAvax);
    if (!amountWei) {
      setSubmitError("Invalid AVAX amount.");
      return;
    }
    if (values.arbiterAddress.toLowerCase() === address.toLowerCase()) {
      setSubmitError("Arbiter address cannot be the same as the seller wallet.");
      return;
    }
    if (values.buyerAddress && values.buyerAddress.toLowerCase() === address.toLowerCase()) {
      setSubmitError("Buyer address cannot be the same as the seller wallet.");
      return;
    }

    const fundingEpoch = Math.floor(Date.parse(values.fundingDeadline) / 1000);
    const deliveryEpoch = Math.floor(Date.parse(values.deliveryDeadline) / 1000);
    const inspectionWindowSeconds = values.inspectionHours * 3600;
    const normalizedBuyer = values.buyerAddress.trim() ? (values.buyerAddress.trim() as `0x${string}`) : null;

    try {
      const { termsHash } = await computeCanonicalTermsHash({
        version: 1,
        chainId: env.chainId,
        seller: address,
        buyer: normalizedBuyer,
        arbiter: values.arbiterAddress.trim(),
        amountWei: amountWei.toString(),
        fundingDeadline: fundingEpoch,
        deliveryDeadline: deliveryEpoch,
        inspectionWindowSeconds,
        title: values.title,
        description: values.description,
        terms: values.terms,
      });

      const draft = await createDraftMutation.mutateAsync({
        title: values.title.trim(),
        description: values.description.trim(),
        amountWei: amountWei.toString(),
        buyerAddress: normalizedBuyer,
        arbiterAddress: values.arbiterAddress.trim() as `0x${string}`,
        fundingDeadlineEpochSeconds: fundingEpoch,
        deliveryDeadlineEpochSeconds: deliveryEpoch,
        inspectionWindowSeconds,
        terms: values.terms.trim(),
      });

      if (draft.termsHash.toLowerCase() !== termsHash.toLowerCase()) {
        throw new Error("Canonical terms hash mismatch between client and backend.");
      }

      setClientTermsHash(termsHash);
      setSubmittedCreateTxHash(null);
      setPreviewDraft(draft);
      persistDraftState({
        previewDraft: draft,
        clientTermsHash: termsHash,
        submittedCreateTxHash: null,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to prepare deal draft.");
    }
  }

  async function onSubmitOnChain() {
    if (!previewDraft) return;
    setSubmitError(null);
    inFlightSubmitRef.current = true;
    const effectiveTermsHash = clientTermsHash ?? previewDraft.termsHash;

    try {
      const deal = previewDraft.deal;
      let txHash = submittedCreateTxHash;
      if (!txHash && pendingTx?.action === "createTrade") {
        const recovered = await waitForHash(pendingTx.txHash);
        txHash = recovered.txHash;
        setSubmittedCreateTxHash(txHash);
        persistDraftState({
          previewDraft,
          clientTermsHash: effectiveTermsHash,
          submittedCreateTxHash: txHash,
        });
      } else if (!txHash) {
        const result = await createTrade(
          {
            tradeId: previewDraft.tradeId,
            preassignedBuyer: deal.buyer ?? zeroAddress,
            arbiter: deal.arbiter,
            amountWei: BigInt(deal.amountWei),
            termsHash: previewDraft.termsHash,
            fundingDeadline: BigInt(Math.floor(Date.parse(deal.fundingDeadline) / 1000)),
            deliveryDeadline: BigInt(Math.floor(Date.parse(deal.deliveryDeadline) / 1000)),
            inspectionWindow: BigInt(deal.inspectionWindowSeconds),
          },
          (hash) => setPending(hash, "createTrade")
        );
        txHash = result.txHash;
        setSubmittedCreateTxHash(txHash);
        persistDraftState({
          previewDraft,
          clientTermsHash: effectiveTermsHash,
          submittedCreateTxHash: txHash,
        });
      }

      await bindDealTxAsync({
        tradeId: previewDraft.tradeId,
        txHash,
      });

      clearPending();
      clearDraftState();
      setSubmittedCreateTxHash(null);
      setCreatedTradeId(previewDraft.tradeId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to deploy trade on-chain.";
      if (!submittedCreateTxHashRef.current && message.includes("reverted on-chain")) {
        clearPending();
      }
      setSubmitError(message);
    } finally {
      inFlightSubmitRef.current = false;
    }
  }

  function handleEditDraft() {
    clearDraftState();
    recoveredPendingHashRef.current = null;
    setPreviewDraft(null);
    setClientTermsHash(null);
    setSubmittedCreateTxHash(null);
    setSubmitError(null);
  }

  async function handleCopyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <AppShell
      title="Create Escrow Deal"
      subtitle="Prepare canonical terms off-chain, verify the SHA-256 commitment, and bind your trade on-chain."
    >
      {!env.escrowContractAddress && (
        <AlertBanner tone="warning" title="Contract Not Configured" message={appConfig.messages.contractUnconfigured} />
      )}

      {(submitError || txError) && (
        <AlertBanner tone="error" title="Action Blocked" message={submitError ?? txError ?? ""} />
      )}

      {createdTradeId ? (
        <Panel className="space-y-5">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-emerald-300">On-Chain Verified</p>
            <h2 className="text-xl font-medium text-white">Deal Created & Bound</h2>
            <p className="text-sm text-white/65">
              Share this deal URL with the buyer so they can inspect the terms and fund the escrow.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-black p-4">
            <code className="flex-1 break-all text-xs text-white/85">{shareUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => void handleCopyShareUrl()}>
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedLink ? "Copied" : "Copy Link"}</span>
            </Button>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => navigate(dealPath(createdTradeId))}>
              <span>Open Deal</span>
              <ArrowRight size={15} />
            </Button>
            <Link
              to="/dashboard"
              className="inline-flex items-center rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/5"
            >
              Go to My Deals
            </Link>
          </div>
        </Panel>
      ) : previewDraft ? (
        <Panel className="space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Step 2 of 2 · Transaction Preview</p>
              <h2 className="mt-1 text-lg font-medium text-white">{previewDraft.deal.title}</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                Boolean(activeAction) ||
                isRecoveringPending ||
                bindTxMutation.isPending ||
                Boolean(confirmedOrPendingCreateTxHash)
              }
              onClick={handleEditDraft}
            >
              Edit Draft
            </Button>
          </div>

          {confirmedOrPendingCreateTxHash && (
            <AlertBanner
              tone="info"
              title="On-Chain Transaction Submitted"
              message={`Trade transaction ${confirmedOrPendingCreateTxHash} is already submitted. Retry backend verification below instead of recreating the trade.`}
            />
          )}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-white/50">Trade ID</dt>
              <dd className="mt-1 font-mono text-xs break-all text-white">{previewDraft.tradeId}</dd>
            </div>
            <div>
              <dt className="text-white/50">Terms Hash (RFC 8785 SHA-256)</dt>
              <dd className="mt-1 font-mono text-xs break-all text-emerald-300">
                {clientTermsHash ?? previewDraft.termsHash}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Escrow Amount (wei)</dt>
              <dd className="mt-1 font-mono text-xs text-white">{previewDraft.deal.amountWei}</dd>
            </div>
            <div>
              <dt className="text-white/50">Assigned Arbiter</dt>
              <dd className="mt-1 font-mono text-xs break-all text-white">{previewDraft.deal.arbiter}</dd>
            </div>
          </dl>

          <div className="rounded-xl border border-white/10 bg-black p-4 text-xs text-white/65">
            Submitting this transaction writes the trade commitment to SafeDealEscrow ({previewDraft.contractAddress})
            without locking seller funds. Only the buyer deposits AVAX during funding.
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              disabled={
                Boolean(activeAction) ||
                isRecoveringPending ||
                bindTxMutation.isPending ||
                (!confirmedOrPendingCreateTxHash && !env.escrowContractAddress)
              }
              onClick={() => void onSubmitOnChain()}
            >
              {activeAction === "createTrade" || isRecoveringPending
                ? "Confirm & Wait for Receipt..."
                : bindTxMutation.isPending
                  ? "Verifying on Backend..."
                  : confirmedOrPendingCreateTxHash
                    ? "Retry Backend Binding"
                    : "Create Trade On-Chain"}
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel>
          <form onSubmit={handleSubmit(onDraftPreview)} className="space-y-5" noValidate>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="deal-title" className="block text-sm font-medium text-white">
                  Deal Title
                </label>
                <input
                  id="deal-title"
                  type="text"
                  placeholder="e.g. Custom Brand Identity & Design System"
                  {...register("title")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white focus:outline-none"
                />
                {errors.title && <p className="mt-1 text-xs text-red-300">{errors.title.message}</p>}
              </div>

              <div className="md:col-span-2">
                <label htmlFor="deal-description" className="block text-sm font-medium text-white">
                  Description
                </label>
                <textarea
                  id="deal-description"
                  rows={3}
                  placeholder="Scope of work, deliverables, and handover format"
                  {...register("description")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white focus:outline-none"
                />
                {errors.description && <p className="mt-1 text-xs text-red-300">{errors.description.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-amount" className="block text-sm font-medium text-white">
                  Amount ({appConfig.escrow.nativeSymbol})
                </label>
                <input
                  id="deal-amount"
                  type="text"
                  inputMode="decimal"
                  {...register("amountAvax")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 font-mono text-sm text-white focus:border-white focus:outline-none"
                />
                {errors.amountAvax && <p className="mt-1 text-xs text-red-300">{errors.amountAvax.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-inspection" className="block text-sm font-medium text-white">
                  Inspection Window (hours)
                </label>
                <input
                  id="deal-inspection"
                  type="number"
                  min={1}
                  max={720}
                  {...register("inspectionHours")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 font-mono text-sm text-white focus:border-white focus:outline-none"
                />
                {errors.inspectionHours && <p className="mt-1 text-xs text-red-300">{errors.inspectionHours.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-funding-deadline" className="block text-sm font-medium text-white">
                  Funding Deadline
                </label>
                <input
                  id="deal-funding-deadline"
                  type="datetime-local"
                  {...register("fundingDeadline")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 text-sm text-white focus:border-white focus:outline-none"
                />
                {errors.fundingDeadline && <p className="mt-1 text-xs text-red-300">{errors.fundingDeadline.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-delivery-deadline" className="block text-sm font-medium text-white">
                  Delivery Deadline
                </label>
                <input
                  id="deal-delivery-deadline"
                  type="datetime-local"
                  {...register("deliveryDeadline")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 text-sm text-white focus:border-white focus:outline-none"
                />
                {errors.deliveryDeadline && <p className="mt-1 text-xs text-red-300">{errors.deliveryDeadline.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-arbiter" className="block text-sm font-medium text-white">
                  Arbiter Wallet Address
                </label>
                <input
                  id="deal-arbiter"
                  type="text"
                  placeholder="0x..."
                  {...register("arbiterAddress")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-white/35 focus:border-white focus:outline-none"
                />
                {errors.arbiterAddress && <p className="mt-1 text-xs text-red-300">{errors.arbiterAddress.message}</p>}
              </div>

              <div>
                <label htmlFor="deal-buyer" className="block text-sm font-medium text-white">
                  Preassigned Buyer Address (optional)
                </label>
                <input
                  id="deal-buyer"
                  type="text"
                  placeholder="Leave empty for any eligible buyer via deal link"
                  {...register("buyerAddress")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-white/35 focus:border-white focus:outline-none"
                />
                {errors.buyerAddress && <p className="mt-1 text-xs text-red-300">{errors.buyerAddress.message}</p>}
              </div>

              <div className="md:col-span-2">
                <label htmlFor="deal-terms" className="block text-sm font-medium text-white">
                  Terms & Acceptance Criteria
                </label>
                <textarea
                  id="deal-terms"
                  rows={4}
                  placeholder="Specify clear acceptance tests, deliverables, and refund conditions"
                  {...register("terms")}
                  className="mt-2 w-full rounded-lg border border-white/20 bg-black px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white focus:outline-none"
                />
                {errors.terms && <p className="mt-1 text-xs text-red-300">{errors.terms.message}</p>}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
              <p className="text-xs text-white/55">
                {isConnected ? "Next step verifies canonical terms hash before on-chain signing." : "Connect your wallet to continue."}
              </p>
              <Button type="submit" size="lg" disabled={isSubmitting || createDraftMutation.isPending}>
                {createDraftMutation.isPending ? "Preparing Draft..." : "Preview On-Chain Transaction"}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </AppShell>
  );
}
