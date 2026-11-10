import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bindDealTransaction,
  createDealDraft,
  getDeal,
  getDealHistory,
  listDeals,
  syncDealState,
  type ListDealsFilters,
} from "@/features/deals/api/deals-api";
import type { CreateDealDraftRequest } from "@/types/api";

export const dealKeys = {
  all: ["deals"] as const,
  list: (filters: ListDealsFilters) => ["deals", "list", filters] as const,
  detail: (tradeId: string) => ["deals", "detail", tradeId] as const,
  history: (tradeId: string) => ["deals", "history", tradeId] as const,
};

export function useDealsQuery(filters: ListDealsFilters, enabled = true) {
  return useQuery({
    queryKey: dealKeys.list(filters),
    queryFn: () => listDeals(filters),
    enabled,
  });
}

export function useDealQuery(tradeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dealKeys.detail(tradeId ?? ""),
    queryFn: () => getDeal(tradeId!),
    enabled: Boolean(tradeId && enabled),
  });
}

export function useDealHistoryQuery(tradeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dealKeys.history(tradeId ?? ""),
    queryFn: () => getDealHistory(tradeId!),
    enabled: Boolean(tradeId && enabled),
  });
}

export function useCreateDealDraftMutation() {
  return useMutation({
    mutationFn: (payload: CreateDealDraftRequest) => createDealDraft(payload),
  });
}

export function useBindDealTxMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, txHash }: { tradeId: string; txHash: `0x${string}` }) =>
      bindDealTransaction(tradeId, txHash),
    onSuccess: (deal) => {
      queryClient.setQueryData(dealKeys.detail(deal.tradeId), deal);
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}

export function useSyncDealMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, txHash }: { tradeId: string; txHash?: `0x${string}` }) =>
      syncDealState(tradeId, txHash),
    onSuccess: (deal) => {
      queryClient.setQueryData(dealKeys.detail(deal.tradeId), deal);
      void queryClient.invalidateQueries({ queryKey: dealKeys.history(deal.tradeId) });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
    },
  });
}
