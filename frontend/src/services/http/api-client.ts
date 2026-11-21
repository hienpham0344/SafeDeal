import { env } from "@/config/env";
import type { ApiErrorPayload } from "@/types/api";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly fieldErrors: ApiErrorPayload["fieldErrors"];

  constructor(
    status: number,
    message: string,
    code = "REQUEST_FAILED",
    correlationId?: string,
    fieldErrors?: ApiErrorPayload["fieldErrors"]
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.fieldErrors = fieldErrors;
  }
}

const NON_RETRYABLE_QUERY_STATUSES = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 429]);
const PENDING_RECEIPT_ERROR_PATTERN = /receipt not found or (?:still )?pending/i;
const DEFAULT_PENDING_RECEIPT_RETRY_DELAYS_MS = [1500, 2000, 2500, 3000, 3500, 4000] as const;

export function shouldRetryQueryError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && NON_RETRYABLE_QUERY_STATUSES.has(error.status)) {
    return false;
  }
  return failureCount < 2;
}

/**
 * Returns true when the backend rejects a tx-sync call only because its RPC node
 * or confirmation threshold has not observed the mined receipt yet.
 */
export function isPendingReceiptApiError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 400 &&
    PENDING_RECEIPT_ERROR_PATTERN.test(error.message)
  );
}

export interface PendingReceiptRetryOptions {
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Retries a tx verification API call with short backoff when the backend is waiting
 * for additional block confirmations or RPC indexing after the wallet reports 1 confirmation.
 */
export async function retryOnPendingReceipt<T>(
  operation: () => Promise<T>,
  options: PendingReceiptRetryOptions = {}
): Promise<T> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_PENDING_RECEIPT_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (!isPendingReceiptApiError(error) || delayMs === undefined) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

const BEARER_TOKEN_KEY = "safedeal_bearer_token";

let inMemoryCsrfToken: string | null = null;
let inMemoryBearerToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function setBearerToken(token: string | null): void {
  inMemoryBearerToken = token;
  if (typeof window !== "undefined") {
    try {
      if (token) {
        window.sessionStorage.setItem(BEARER_TOKEN_KEY, token);
      } else {
        window.sessionStorage.removeItem(BEARER_TOKEN_KEY);
      }
    } catch {
      // Ignore storage access errors in restricted browser contexts
    }
  }
}

export function resolveBearerToken(): string | null {
  if (inMemoryBearerToken) return inMemoryBearerToken;
  if (typeof window !== "undefined") {
    try {
      return window.sessionStorage.getItem(BEARER_TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return null;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function resolveCsrfToken(): string | null {
  return readCookie("safedeal_csrf") ?? inMemoryCsrfToken;
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };

  let requestBody: BodyInit | undefined;
  if (options.body instanceof FormData) {
    requestBody = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(options.body);
  }

  if (method !== "GET") {
    const csrf = resolveCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }

  const bearer = resolveBearerToken();
  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  }

  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    method,
    headers,
    body: requestBody,
    credentials: "include",
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401) {
      inMemoryCsrfToken = null;
      setBearerToken(null);
      if (path !== "/api/v1/auth/me") {
        unauthorizedHandler?.();
      }
    }
    const err = payload as Partial<ApiErrorPayload> | null;
    throw new ApiClientError(
      response.status,
      err?.message || `Request failed with status ${response.status}`,
      err?.code || "HTTP_ERROR",
      err?.correlationId,
      err?.fieldErrors
    );
  }

  return payload as T;
}

export function buildDownloadUrl(path: string): string {
  return `${env.apiBaseUrl}${path}`;
}
