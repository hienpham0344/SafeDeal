import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAssignedDisputes, recordArbitrationResolution } from "@/features/arbitration/api/arbitration-api";
import { dealKeys } from "@/features/deals/hooks/useDeals";
import { disputeKeys } from "@/features/disputes/hooks/useDisputes";

export const arbitrationKeys = {
  assigned: ["arbitration", "assigned"] as const,
};

export function useAssignedDisputesQuery(enabled = true) {
  return useQuery({
    queryKey: arbitrationKeys.assigned,
    queryFn: listAssignedDisputes,
    enabled,
  });
}

export function useRecordResolutionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      disputeId,
      txHash,
      rationale,
    }: {
      disputeId: number;
      txHash: `0x${string}`;
      rationale: string;
    }) => recordArbitrationResolution(disputeId, { txHash, rationale }),
    onSuccess: (dispute) => {
      queryClient.setQueryData(disputeKeys.detail(String(dispute.id)), dispute);
      void queryClient.invalidateQueries({ queryKey: arbitrationKeys.assigned });
      void queryClient.invalidateQueries({ queryKey: dealKeys.detail(dispute.tradeId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}
