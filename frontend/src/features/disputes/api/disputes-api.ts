import { apiRequest, retryOnPendingReceipt } from "@/services/http/api-client";
import type { DisputeDetail, DisputeEvidenceItem } from "@/types/api";

export async function createDisputeMetadata(
  tradeId: string,
  payload: { reason: string; summary: string; txHash?: `0x${string}` }
): Promise<DisputeDetail> {
  const run = () =>
    apiRequest<DisputeDetail>(`/api/v1/deals/${encodeURIComponent(tradeId)}/disputes`, {
      method: "POST",
      body: payload,
    });
  return payload.txHash ? retryOnPendingReceipt(run) : run();
}

export async function getDispute(disputeId: string): Promise<DisputeDetail> {
  return apiRequest<DisputeDetail>(`/api/v1/disputes/${encodeURIComponent(disputeId)}`);
}

export async function listDisputeEvidence(disputeId: string): Promise<readonly DisputeEvidenceItem[]> {
  return apiRequest<readonly DisputeEvidenceItem[]>(`/api/v1/disputes/${encodeURIComponent(disputeId)}/evidence`);
}

export async function submitDisputeEvidence(
  disputeId: string,
  input: { title: string; notes: string; file?: File | null }
): Promise<DisputeEvidenceItem> {
  const form = new FormData();
  form.append("title", input.title);
  form.append("notes", input.notes);
  if (input.file) {
    form.append("file", input.file);
  }
  return apiRequest<DisputeEvidenceItem>(`/api/v1/disputes/${encodeURIComponent(disputeId)}/evidence`, {
    method: "POST",
    body: form,
  });
}

export async function submitDisputeVoteRecord(
  disputeId: number | string,
  payload: { txHash: `0x${string}`; rationale?: string }
): Promise<DisputeDetail> {
  return retryOnPendingReceipt(() =>
    apiRequest<DisputeDetail>(`/api/v1/disputes/${encodeURIComponent(String(disputeId))}/votes`, {
      method: "POST",
      body: payload,
    })
  );
}

export async function recordDisputeTimeoutResolution(
  disputeId: number | string,
  payload: { txHash: `0x${string}` }
): Promise<DisputeDetail> {
  return retryOnPendingReceipt(() =>
    apiRequest<DisputeDetail>(`/api/v1/disputes/${encodeURIComponent(String(disputeId))}/timeout`, {
      method: "POST",
      body: payload,
    })
  );
}
