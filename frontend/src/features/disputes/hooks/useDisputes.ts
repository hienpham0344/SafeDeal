import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDisputeMetadata,
  getDispute,
  listDisputeEvidence,
  recordDisputeTimeoutResolution,
  submitDisputeEvidence,
  submitDisputeVoteRecord,
} from "@/features/disputes/api/disputes-api";
import { dealKeys } from "@/features/deals/hooks/useDeals";
import type { DisputeDetail } from "@/types/api";

export const disputeKeys = {
  detail: (id: string) => ["disputes", "detail", id] as const,
  evidence: (id: string) => ["disputes", "evidence", id] as const,
};

export function useDisputeQuery(disputeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: disputeKeys.detail(disputeId ?? ""),
    queryFn: () => getDispute(disputeId!),
    enabled: Boolean(disputeId && enabled),
  });
}

export function useDisputeEvidenceQuery(disputeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: disputeKeys.evidence(disputeId ?? ""),
    queryFn: () => listDisputeEvidence(disputeId!),
    enabled: Boolean(disputeId && enabled),
  });
}

export function useCreateDisputeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tradeId,
      reason,
      summary,
      txHash,
    }: {
      tradeId: string;
      reason: string;
      summary: string;
      txHash?: `0x${string}`;
    }) => createDisputeMetadata(tradeId, { reason, summary, txHash }),
    onSuccess: (dispute) => {
      queryClient.setQueryData(disputeKeys.detail(String(dispute.id)), dispute);
      void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dispute.tradeId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

export function useSubmitEvidenceMutation(disputeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; notes: string; file?: File | null }) =>
      submitDisputeEvidence(disputeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: disputeKeys.evidence(disputeId) });
    },
  });
}

function syncDisputeCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  dispute: DisputeDetail
): void {
  queryClient.setQueryData(disputeKeys.detail(String(dispute.id)), dispute);
  queryClient.setQueryData<readonly DisputeDetail[]>(["arbitration", "assigned"], (old) =>
    old ? old.map((item) => (item.id === dispute.id ? dispute : item)) : old
  );
  void queryClient.invalidateQueries({ queryKey: ["arbitration", "assigned"] });
  void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dispute.tradeId) });
  void queryClient.invalidateQueries({ queryKey: dealKeys.all });
}

export function useSubmitDisputeVoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      txHash,
      rationale,
    }: {
      disputeId: number;
      txHash: `0x${string}`;
      rationale?: string;
    }) => submitDisputeVoteRecord(disputeId, { txHash, rationale }),
    onSuccess: (dispute) => syncDisputeCaches(queryClient, dispute),
  });
}

export function useRecordTimeoutResolutionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, txHash }: { disputeId: number; txHash: `0x${string}` }) =>
      recordDisputeTimeoutResolution(disputeId, { txHash }),
    onSuccess: (dispute) => syncDisputeCaches(queryClient, dispute),
  });
}
