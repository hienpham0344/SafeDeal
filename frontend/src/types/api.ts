export type DealStatus =
  | "DRAFT"
  | "CREATED"
  | "FUNDED"
  | "DELIVERED"
  | "RELEASED"
  | "REFUNDED"
  | "DISPUTED"
  | "RESOLVED"
  | "CANCELLED";

export type DisputeStatus = "OPEN" | "RESOLVED";

export interface ApiFieldError {
  readonly field: string;
  readonly message: string;
}

export interface ApiErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly fieldErrors?: readonly ApiFieldError[];
}

export interface AuthNonceResponse {
  readonly nonce: string;
  readonly domain: string;
  readonly uri: string;
  readonly chainId: number;
  readonly issuedAt: string;
  readonly expirationTime: string;
  readonly statement: string;
  readonly message: string;
}

export interface AuthSessionUser {
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly authenticatedAt: string;
  readonly csrfToken?: string;
}

export interface DealSummary {
  readonly tradeId: `0x${string}`;
  readonly title: string;
  readonly description: string;
  readonly seller: `0x${string}`;
  readonly buyer: `0x${string}` | null;
  readonly arbiter: `0x${string}`;
  readonly amountWei: string;
  readonly termsHash: `0x${string}`;
  readonly fundingDeadline: string;
  readonly deliveryDeadline: string;
  readonly inspectionWindowSeconds: number;
  readonly status: DealStatus;
  readonly onChainBound: boolean;
  readonly settled: boolean;
  readonly deliveredAt: string | null;
  readonly fundedAt: string | null;
  readonly createdAt: string;
  readonly disputeId: number | null;
}

export interface DealDetail extends DealSummary {
  readonly terms: string;
  readonly canonicalTermsJson: string;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly createTxHash: `0x${string}` | null;
}

export interface DealEventItem {
  readonly id: number;
  readonly eventType: string;
  readonly actorAddress: `0x${string}` | null;
  readonly txHash: `0x${string}` | null;
  readonly blockNumber: number | null;
  readonly details: string;
  readonly createdAt: string;
}

export interface BlockchainTransactionItem {
  readonly id: number;
  readonly txHash: `0x${string}`;
  readonly operation: string;
  readonly status: string;
  readonly blockNumber: number | null;
  readonly submittedBy: `0x${string}` | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export interface DealHistoryResponse {
  readonly events: readonly DealEventItem[];
  readonly transactions: readonly BlockchainTransactionItem[];
}

export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly size: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface CreateDealDraftRequest {
  readonly title: string;
  readonly description: string;
  readonly amountWei: string;
  readonly buyerAddress?: `0x${string}` | null;
  readonly arbiterAddress: `0x${string}`;
  readonly fundingDeadlineEpochSeconds: number;
  readonly deliveryDeadlineEpochSeconds: number;
  readonly inspectionWindowSeconds: number;
  readonly terms: string;
}

export interface CreateDealDraftResponse {
  readonly deal: DealDetail;
  readonly tradeId: `0x${string}`;
  readonly termsHash: `0x${string}`;
  readonly canonicalTermsJson: string;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
}

export interface DisputeDetail {
  readonly id: number;
  readonly tradeId: `0x${string}`;
  readonly dealTitle: string;
  readonly dealAmountWei: string;
  readonly seller: `0x${string}`;
  readonly buyer: `0x${string}`;
  readonly arbiter: `0x${string}`;
  readonly openedBy: `0x${string}`;
  readonly reason: string;
  readonly summary: string;
  readonly status: DisputeStatus;
  readonly buyerAwardWei: string | null;
  readonly sellerAwardWei: string | null;
  readonly resolutionRationale: string | null;
  readonly openTxHash: `0x${string}` | null;
  readonly resolveTxHash: `0x${string}` | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface DisputeEvidenceItem {
  readonly id: number;
  readonly disputeId: number;
  readonly submittedBy: `0x${string}`;
  readonly title: string;
  readonly notes: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly sha256Hex: string | null;
  readonly hasAttachment: boolean;
  readonly createdAt: string;
}

export interface HealthStatusResponse {
  readonly status: string;
  readonly service: string;
  readonly chainId: number;
  readonly chainName: string;
  readonly escrowContractConfigured: boolean;
}
