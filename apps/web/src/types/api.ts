/** Mirrors the backend's ApiError record (apps/api .../common/error/ApiError.java). */
export interface ApiError {
  timestamp: string;
  status: number;
  code: string;
  message: string;
  path: string;
}

export interface HealthResponse {
  status: "UP" | "DOWN";
  service: string;
  timestamp: string;
}

/** Mirrors BlockchainTransactionStatus on the backend. */
export type ChainTransactionStatus = "SUBMITTED" | "PENDING" | "CONFIRMED" | "FAILED";
