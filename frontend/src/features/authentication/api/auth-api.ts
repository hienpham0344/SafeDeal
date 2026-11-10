import { apiRequest, setCsrfToken } from "@/services/http/api-client";
import type { AuthNonceResponse, AuthSessionUser } from "@/types/api";

export async function requestAuthNonce(address: `0x${string}`, chainId: number): Promise<AuthNonceResponse> {
  return apiRequest<AuthNonceResponse>("/api/v1/auth/nonce", {
    method: "POST",
    body: { address, chainId },
  });
}

export async function verifyWalletSignature(
  message: string,
  signature: `0x${string}`
): Promise<AuthSessionUser> {
  const user = await apiRequest<AuthSessionUser>("/api/v1/auth/verify", {
    method: "POST",
    body: { message, signature },
  });
  if (user.csrfToken) {
    setCsrfToken(user.csrfToken);
  }
  return user;
}

export async function fetchCurrentSession(): Promise<AuthSessionUser | null> {
  try {
    const user = await apiRequest<AuthSessionUser>("/api/v1/auth/me");
    if (user.csrfToken) {
      setCsrfToken(user.csrfToken);
    }
    return user;
  } catch {
    return null;
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
  } finally {
    setCsrfToken(null);
  }
}
