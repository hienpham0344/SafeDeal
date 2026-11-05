import { env } from "@/config/env";
import type { ApiError } from "@/types/api";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; accessToken?: string };

/**
 * Thin fetch wrapper for the SafeDeal REST API. The access token is passed in by the caller;
 * the auth feature decides where it lives (memory, not localStorage).
 */
export async function apiRequest<T>(path: string, { body, accessToken, headers, ...init }: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(response.status, error);
  }
  return (await response.json()) as T;
}
