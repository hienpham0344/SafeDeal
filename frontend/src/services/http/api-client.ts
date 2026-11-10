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

export function shouldRetryQueryError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && NON_RETRYABLE_QUERY_STATUSES.has(error.status)) {
    return false;
  }
  return failureCount < 2;
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
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
