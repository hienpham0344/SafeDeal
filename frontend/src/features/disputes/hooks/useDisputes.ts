import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDisputeMetadata,
  getDispute,
  listDisputeEvidence,
  submitDisputeEvidence,
} from "@/features/disputes/api/disputes-api";
import { dealKeys } from "@/features/deals/hooks/useDeals";

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
