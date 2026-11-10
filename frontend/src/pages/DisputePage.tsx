import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Download, Paperclip } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AlertBanner, EmptyState, LoadingState, Panel, StatusBadge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { dealPath } from "@/config/routes";
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
import { formatAvax, formatTimestamp } from "@/utils/format";

export function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { address, isConnected, isAuthenticated, openWalletModal, signInWithWallet } = useAuthSession();

  const disputeQuery = useDisputeQuery(id, isAuthenticated);
  const evidenceQuery = useDisputeEvidenceQuery(id, isAuthenticated);
  const submitEvidence = useSubmitEvidenceMutation(id ?? "");

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
      setSelectedFile(null);
      setSubmitSuccess("Evidence recorded securely and restricted to case participants.");
    } catch {
      // Mutation errors are surfaced via submitEvidence.isError AlertBanner
    }
  }

  return (
    <AppShell
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
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs text-white/50">Dispute Reason</p>
                  <h2 className="mt-1 text-lg font-medium text-white">{dispute.reason}</h2>
                </div>
                <StatusBadge status={dispute.status} />
              </div>

              <div>
                <h3 className="text-sm font-medium text-white">Summary</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/75">{dispute.summary}</p>
              </div>

              {dispute.status === "RESOLVED" && (
                <div className="rounded-xl border border-white/20 bg-white/5 p-4 space-y-2 text-sm">
                  <p className="font-medium text-white">Arbitration Resolution Recorded</p>
                  <p className="text-white/75">
                    Buyer Award: <span className="font-mono text-white">{formatAvax(dispute.buyerAwardWei ?? "0")}</span>{" "}
                    · Seller Award: <span className="font-mono text-white">{formatAvax(dispute.sellerAwardWei ?? "0")}</span>
                  </p>
                  {dispute.resolutionRationale && (
                    <p className="text-xs text-white/65">Rationale: {dispute.resolutionRationale}</p>
                  )}
                </div>
              )}

              <div className="space-y-3 border-t border-white/10 pt-5">
                <h3 className="text-sm font-medium text-white">Submitted Evidence</h3>
                {evidenceQuery.isLoading ? (
                  <p className="text-sm text-white/50">Loading evidence...</p>
                ) : !evidenceQuery.data || evidenceQuery.data.length === 0 ? (
                  <p className="text-sm text-white/50">No evidence items uploaded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {evidenceQuery.data.map((item) => (
                      <div key={item.id} className="rounded-xl border border-white/10 bg-black p-4 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{item.title}</p>
                            <p className="mt-0.5 font-mono text-xs text-white/45">
                              Submitted by {item.submittedBy} · {formatTimestamp(item.createdAt)}
                            </p>
                          </div>
                          {item.hasAttachment && (
                            <a
                              href={buildDownloadUrl(`/api/v1/disputes/${dispute.id}/evidence/${item.id}/download`)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
                            >
                              <Download size={13} />
                              <span>{item.fileName ?? "Download"}</span>
                            </a>
                          )}
                        </div>
                        <p className="text-sm text-white/75">{item.notes}</p>
                        {item.sha256Hex && (
                          <p className="font-mono text-[11px] text-white/40 break-all">
                            SHA-256: {item.sha256Hex}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canSubmitEvidence && (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 border-t border-white/10 pt-5">
                  <h3 className="text-sm font-medium text-white">Submit Additional Evidence</h3>
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
                    <label htmlFor="ev-title" className="block text-xs text-white/60">
                      Evidence Title
                    </label>
                    <input
                      id="ev-title"
                      type="text"
                      {...register("title")}
                      className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
                    />
                    {errors.title && <p className="mt-1 text-xs text-red-300">{errors.title.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="ev-notes" className="block text-xs text-white/60">
                      Explanation
                    </label>
                    <textarea
                      id="ev-notes"
                      rows={3}
                      {...register("notes")}
                      className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
                    />
                    {errors.notes && <p className="mt-1 text-xs text-red-300">{errors.notes.message}</p>}
                  </div>
                  <div>
                    <label
                      htmlFor="ev-file"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 px-3.5 py-2 text-xs text-white hover:bg-white/5"
                    >
                      <Paperclip size={14} />
                      <span>{selectedFile ? selectedFile.name : "Attach PNG, JPEG, PDF, or TXT (optional)"}</span>
                    </label>
                    <input
                      id="ev-file"
                      type="file"
                      accept="image/png,image/jpeg,application/pdf,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setSelectedFile(file);
                        setFileError(validateEvidenceFile(file));
                      }}
                    />
                  </div>
                  <Button type="submit" disabled={submitEvidence.isPending}>
                    {submitEvidence.isPending ? "Uploading..." : "Submit Evidence"}
                  </Button>
                </form>
              )}
            </Panel>

            <Panel className="space-y-4">
              <h2 className="text-base font-medium text-white">Parties & Arbiter</h2>
              <dl className="space-y-3 text-xs">
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Escrow Amount</dt>
                  <dd className="mt-1 font-mono text-sm text-white">{formatAvax(dispute.dealAmountWei)}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Seller</dt>
                  <dd className="mt-1 font-mono break-all text-white/85">{dispute.seller}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Buyer</dt>
                  <dd className="mt-1 font-mono break-all text-white/85">{dispute.buyer}</dd>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <dt className="text-white/45">Assigned Arbiter</dt>
                  <dd className="mt-1 font-mono break-all text-white/85">{dispute.arbiter}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Opened At</dt>
                  <dd className="mt-1 text-white/85">{formatTimestamp(dispute.createdAt)}</dd>
                </div>
              </dl>

              <Link
                to={dealPath(dispute.tradeId)}
                className="inline-flex w-full justify-center rounded-lg border border-white/20 px-4 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                View Parent Deal
              </Link>
            </Panel>
          </div>
        </div>
      )}
    </AppShell>
  );
}
