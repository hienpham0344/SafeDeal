import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, Download, FileText, Paperclip, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { CopyableHash } from "@/components/ui/CopyableHash";
import { dealPath, ROUTES } from "@/config/routes";
import { useAuthSession } from "@/features/authentication/hooks/useAuthSession";
import {
  useDisputeEvidenceQuery,
  useDisputeQuery,
  useSubmitEvidenceMutation,
} from "@/features/disputes/hooks/useDisputes";
import {
  submitEvidenceSchema,
  validateEvidenceFile,
  type SubmitEvidenceFormValues,
} from "@/features/disputes/schemas/dispute.schema";
import { buildDownloadUrl } from "@/services/http/api-client";
import type { DisputeDetail } from "@/types/api";
import { formatAvax, formatTimestamp, shortenAddress } from "@/utils/format";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getSubmitterRole(submittedBy: string, dispute: DisputeDetail): {
  readonly label: string;
  readonly badgeClass: string;
} {
  const normalized = submittedBy.toLowerCase();
  if (normalized === dispute.buyer.toLowerCase()) {
    return {
      label: "Buyer",
      badgeClass: "border-sky-400/40 bg-sky-500/15 text-sky-200",
    };
  }
  if (normalized === dispute.seller.toLowerCase()) {
    return {
      label: "Seller",
      badgeClass: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
    };
  }
  if (normalized === dispute.arbiter.toLowerCase()) {
    return {
      label: "Arbiter",
      badgeClass: "border-amber-400/40 bg-amber-500/15 text-amber-200",
    };
  }
  return {
    label: "Participant",
    badgeClass: "border-sd-lineStrong bg-white/[0.05] text-sd-inkMuted",
  };
}

export function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, isAuthenticated, openWalletModal, signInWithWallet } = useAuthSession();

  const disputeQuery = useDisputeQuery(id, isAuthenticated);
  const evidenceQuery = useDisputeEvidenceQuery(id, isAuthenticated);
  const submitEvidence = useSubmitEvidenceMutation(id ?? "");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SubmitEvidenceFormValues>({
    resolver: zodResolver(submitEvidenceSchema),
  });

  const dispute = disputeQuery.data;
  const me = address?.toLowerCase();
  const canSubmitEvidence = Boolean(
    dispute &&
      dispute.status === "OPEN" &&
      me &&
      (dispute.buyer.toLowerCase() === me || dispute.seller.toLowerCase() === me)
  );

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setFileError(validateEvidenceFile(file));
  }

  function handleClearFile() {
    setSelectedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function onSubmit(values: SubmitEvidenceFormValues) {
    setFileError(null);
    setSubmitSuccess(null);
    const validationErr = validateEvidenceFile(selectedFile);
    if (validationErr) {
      setFileError(validationErr);
      return;
    }
    try {
      await submitEvidence.mutateAsync({
        title: values.title,
        notes: values.notes,
        file: selectedFile,
      });
      reset();
      handleClearFile();
      setSubmitSuccess("Evidence recorded securely and restricted to case participants.");
    } catch {
      // Mutation errors are surfaced via submitEvidence.isError AlertBanner
    }
  }

  return (
    <AppShell
      breadcrumb={{ label: "My Deals", to: ROUTES.dashboard }}
      title={dispute ? `Dispute #${dispute.id} · ${dispute.dealTitle}` : "Dispute Center"}
      subtitle={dispute ? `Trade ${dispute.tradeId}` : undefined}
    >
      {!isConnected ? (
        <EmptyState
          title="Connect wallet"
          description="Only verified trade participants and the assigned arbiter can inspect dispute evidence."
          action={<Button onClick={openWalletModal}>Connect Wallet</Button>}
        />
      ) : !isAuthenticated ? (
        <EmptyState
          title="Wallet sign-in required"
          description="Sign in with your wallet to verify participant permissions."
          action={<Button onClick={() => void signInWithWallet()}>Sign In with Wallet</Button>}
        />
      ) : disputeQuery.isLoading ? (
        <LoadingState label="Loading dispute case..." />
      ) : disputeQuery.isError || !dispute ? (
        <AlertBanner
          tone="error"
          title="Access Denied or Not Found"
          message={disputeQuery.error instanceof Error ? disputeQuery.error.message : "Dispute unavailable."}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            <Panel className="lg:col-span-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sd-line pb-5">
                <div className="space-y-1">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                    Dispute Reason
                  </p>
                  <h2 className="text-lg font-medium text-white">{dispute.reason}</h2>
                </div>
                <StatusBadge status={dispute.status} />
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wider text-sd-inkSubtle">
                  Summary
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-sd-inkMuted">
                  {dispute.summary}
                </p>
              </div>

              {dispute.status === "RESOLVED" && (
                <div className="rounded-xl border border-sd-lineStrong bg-sd-elevated/80 p-4 space-y-2 text-sm">
                  <p className="font-medium text-white">Arbitration Resolution Recorded</p>
                  <p className="text-sd-inkMuted tabular-nums">
                    Buyer Award:{" "}
                    <span className="font-mono text-white">{formatAvax(dispute.buyerAwardWei ?? "0")}</span>{" "}
                    · Seller Award:{" "}
                    <span className="font-mono text-white">{formatAvax(dispute.sellerAwardWei ?? "0")}</span>
                  </p>
                  {dispute.resolutionRationale && (
                    <p className="text-xs leading-relaxed text-sd-inkMuted">
                      Rationale: {dispute.resolutionRationale}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-4 border-t border-sd-line pt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-white">Submitted Evidence</h3>
                  {evidenceQuery.data && (
                    <span className="font-mono text-xs text-sd-inkSubtle tabular-nums">
                      {evidenceQuery.data.length} {evidenceQuery.data.length === 1 ? "item" : "items"}
                    </span>
                  )}
                </div>

                {evidenceQuery.isLoading ? (
                  <p className="text-sm text-sd-inkSubtle">Loading evidence...</p>
                ) : !evidenceQuery.data || evidenceQuery.data.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-sd-line bg-sd-inset p-6 text-center">
                    <p className="text-sm text-sd-inkMuted">No evidence items uploaded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {evidenceQuery.data.map((item) => {
                      const role = getSubmitterRole(item.submittedBy, dispute);
                      return (
                        <article
                          key={item.id}
                          className="rounded-xl border border-sd-line bg-sd-inset p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider ${role.badgeClass}`}
                                >
                                  {role.label}
                                </span>
                                <h4 className="text-sm font-medium text-white">{item.title}</h4>
                              </div>
                              <p className="font-mono text-xs text-sd-inkSubtle tabular-nums">
                                Submitted by {shortenAddress(item.submittedBy)} · {formatTimestamp(item.createdAt)}
                              </p>
                            </div>
                            {item.hasAttachment && (
                              <a
                                href={buildDownloadUrl(
                                  `/api/v1/disputes/${dispute.id}/evidence/${item.id}/download`
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-sd-lineStrong bg-sd-elevated/70 px-3 py-1.5 text-xs font-medium text-sd-ink transition-colors hover:border-white/30 hover:bg-sd-elevated"
                              >
                                <Download size={13} aria-hidden="true" />
                                <span>{item.fileName ?? "Download"}</span>
                              </a>
                            )}
                          </div>

                          <p className="text-sm leading-relaxed text-sd-inkMuted whitespace-pre-wrap">
                            {item.notes}
                          </p>

                          {item.sha256Hex && (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sd-line bg-sd-canvas/60 px-3 py-1.5 text-xs">
                              <span className="font-mono text-[11px] uppercase tracking-wider text-sd-inkSubtle">
                                SHA-256
                              </span>
                              <CopyableHash
                                value={item.sha256Hex}
                                label="SHA-256 fingerprint"
                                className="flex-1 text-[11px]"
                              />
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {canSubmitEvidence && (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 border-t border-sd-line pt-6">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-white">Submit Additional Evidence</h3>
                    <p className="text-xs text-sd-inkSubtle">
                      Uploaded files are SHA-256 hashed and restricted to dispute parties and the assigned arbiter.
                    </p>
                  </div>

                  {submitSuccess && <AlertBanner tone="success" message={submitSuccess} />}
                  {(fileError || submitEvidence.isError) && (
                    <AlertBanner
                      tone="error"
                      message={
                        fileError ??
                        (submitEvidence.error instanceof Error ? submitEvidence.error.message : "Upload failed.")
                      }
                    />
                  )}

                  <div>
                    <label htmlFor="ev-title" className="block text-xs font-medium text-sd-inkMuted">
                      Evidence Title
                    </label>
                    <input
                      id="ev-title"
                      type="text"
                      {...register("title")}
                      className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none"
                    />
                    {errors.title && <p className="mt-1 text-xs text-red-300">{errors.title.message}</p>}
                  </div>

                  <div>
                    <label htmlFor="ev-notes" className="block text-xs font-medium text-sd-inkMuted">
                      Explanation
                    </label>
                    <textarea
                      id="ev-notes"
                      rows={3}
                      {...register("notes")}
                      className="mt-1.5 w-full rounded-lg border border-sd-lineStrong bg-sd-inset px-3 py-2 text-sm text-white placeholder:text-sd-inkSubtle focus:border-sd-accent focus:outline-none"
                    />
                    {errors.notes && <p className="mt-1 text-xs text-red-300">{errors.notes.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <span className="block text-xs font-medium text-sd-inkMuted">
                      Supporting Attachment (optional)
                    </span>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dropped = e.dataTransfer.files?.[0] ?? null;
                        if (dropped) {
                          handleFileChange(dropped);
                        }
                      }}
                      className="rounded-xl border border-dashed border-sd-lineStrong bg-sd-inset p-4 transition-colors hover:border-white/30"
                    >
                      <input
                        id="ev-file"
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,application/pdf,text/plain"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          handleFileChange(file);
                        }}
                      />

                      {selectedFile ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sd-line bg-sd-elevated text-sd-accent">
                              <FileText size={16} aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">{selectedFile.name}</p>
                              <p className="font-mono text-xs text-sd-inkSubtle tabular-nums">
                                {formatFileSize(selectedFile.size)} · PNG, JPEG, PDF, or TXT · max 5 MB
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor="ev-file"
                              className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-sd-lineStrong bg-sd-elevated/70 px-3 py-1.5 text-xs font-medium text-sd-ink hover:bg-sd-elevated"
                            >
                              Replace
                            </label>
                            <button
                              type="button"
                              onClick={handleClearFile}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20"
                            >
                              <X size={13} aria-hidden="true" />
                              <span>Remove file</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          htmlFor="ev-file"
                          className="flex cursor-pointer flex-col items-center justify-center gap-2 py-2 text-center"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sd-line bg-sd-elevated text-sd-inkMuted">
                            <Paperclip size={16} aria-hidden="true" />
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-xs font-medium text-white">
                              Click to attach a file or drag and drop
                            </p>
                            <p className="font-mono text-[11px] text-sd-inkSubtle">
                              PNG, JPEG, PDF, or TXT · max 5 MB
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>

                  <Button type="submit" disabled={submitEvidence.isPending}>
                    {submitEvidence.isPending ? "Uploading..." : "Submit Evidence"}
                  </Button>
                </form>
              )}
            </Panel>

            <Panel variant="elevated" className="lg:col-span-4 h-fit space-y-5">
              <div className="flex items-center justify-between border-b border-sd-line pb-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-sd-inkMuted">
                  Parties & Arbiter
                </h2>
                <span className="font-mono text-xs text-sd-inkSubtle">Case #{dispute.id}</span>
              </div>

              <dl className="divide-y divide-sd-line text-xs">
                <div className="pb-3">
                  <dt className="text-sd-inkSubtle">Escrow Amount</dt>
                  <dd className="mt-1 font-mono text-base font-medium text-white tabular-nums">
                    {formatAvax(dispute.dealAmountWei)}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-sd-inkSubtle">Seller</dt>
                  <dd className="mt-1">
                    <CopyableHash
                      value={dispute.seller}
                      label="Seller address"
                      className="w-full text-xs"
                    />
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-sd-inkSubtle">Buyer</dt>
                  <dd className="mt-1">
                    <CopyableHash
                      value={dispute.buyer}
                      label="Buyer address"
                      className="w-full text-xs"
                    />
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-sd-inkSubtle">Assigned Arbiter</dt>
                  <dd className="mt-1">
                    <CopyableHash
                      value={dispute.arbiter}
                      label="Arbiter address"
                      className="w-full text-xs"
                    />
                  </dd>
                </div>
                <div className="pt-3">
                  <dt className="text-sd-inkSubtle">Opened At</dt>
                  <dd className="mt-1 font-mono text-sd-inkMuted tabular-nums">
                    {formatTimestamp(dispute.createdAt)}
                  </dd>
                </div>
              </dl>

              <Link
                to={dealPath(dispute.tradeId)}
                className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-sd-lineStrong bg-sd-inset px-4 py-2 text-xs font-medium text-white transition-colors hover:border-white/30 hover:bg-sd-surface"
              >
                <span>View Parent Deal</span>
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </Panel>
          </div>
        </div>
      )}
    </AppShell>
  );
}
