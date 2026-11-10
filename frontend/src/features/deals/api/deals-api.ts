import { apiRequest } from "@/services/http/api-client";
import type {
  CreateDealDraftRequest,
  CreateDealDraftResponse,
  DealDetail,
  DealHistoryResponse,
  DealSummary,
  PaginatedResponse,
} from "@/types/api";

export interface ListDealsFilters {
  readonly role?: "all" | "seller" | "buyer" | "arbiter" | "created" | "funded";
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

export async function createDealDraft(payload: CreateDealDraftRequest): Promise<CreateDealDraftResponse> {
  return apiRequest<CreateDealDraftResponse>("/api/v1/deals/drafts", {
    method: "POST",
    body: payload,
  });
}

export async function bindDealTransaction(tradeId: string, txHash: `0x${string}`): Promise<DealDetail> {
  return apiRequest<DealDetail>(`/api/v1/deals/${encodeURIComponent(tradeId)}/bind-tx`, {
    method: "POST",
    body: { txHash },
  });
}

export async function syncDealState(tradeId: string, txHash?: `0x${string}`): Promise<DealDetail> {
  return apiRequest<DealDetail>(`/api/v1/deals/${encodeURIComponent(tradeId)}/sync`, {
    method: "POST",
    body: txHash ? { txHash } : {},
  });
}

export async function listDeals(filters: ListDealsFilters = {}): Promise<PaginatedResponse<DealSummary>> {
  const params = new URLSearchParams();
  if (filters.role && filters.role !== "all") params.set("role", filters.role);
  if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
  if (filters.page !== undefined) params.set("page", String(filters.page));
  if (filters.size !== undefined) params.set("size", String(filters.size));
  const qs = params.toString();
  return apiRequest<PaginatedResponse<DealSummary>>(`/api/v1/deals${qs ? `?${qs}` : ""}`);
}

export async function getDeal(tradeId: string): Promise<DealDetail> {
  return apiRequest<DealDetail>(`/api/v1/deals/${encodeURIComponent(tradeId)}`);
}

export async function getDealHistory(tradeId: string): Promise<DealHistoryResponse> {
  return apiRequest<DealHistoryResponse>(`/api/v1/deals/${encodeURIComponent(tradeId)}/history`);
}
