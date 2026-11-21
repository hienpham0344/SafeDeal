import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindDealTransaction, syncDealState } from "@/features/deals/api/deals-api";
import {
  ApiClientError,
  BEARER_TOKEN_KEY,
  apiRequest,
  isPendingReceiptApiError,
  resolveBearerToken,
  retryOnPendingReceipt,
  setBearerToken,
} from "@/services/http/api-client";

const TRADE_ID = "0xdfaa30e28fea61388d7a480a028dbdfe58c9b938b1ec990c8d819d7b5417c2f8";
const TX_HASH = "0xbef61c5ae9fb2e38abfd5aa13afdfd02af25317ebb8064f2c0364d887a91cac" as const;

describe("pending receipt retry helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("identifies all backend pending-receipt validation errors", () => {
    const matchingMessages = [
      `Transaction receipt not found or still pending: ${TX_HASH}`,
      `Transaction receipt not found or still pending on-chain: ${TX_HASH}`,
      `Dispute transaction receipt not found or pending: ${TX_HASH}`,
      `Resolution transaction receipt not found or pending: ${TX_HASH}`,
      `Vote transaction receipt not found or pending: ${TX_HASH}`,
      `Timeout transaction receipt not found or pending: ${TX_HASH}`,
    ];

    for (const msg of matchingMessages) {
      expect(isPendingReceiptApiError(new ApiClientError(400, msg, "VALIDATION_ERROR"))).toBe(true);
    }

    expect(
      isPendingReceiptApiError(
        new ApiClientError(400, `Submitted transaction reverted on-chain: ${TX_HASH}`, "VALIDATION_ERROR")
      )
    ).toBe(false);
    expect(
      isPendingReceiptApiError(
        new ApiClientError(500, `Transaction receipt not found or still pending: ${TX_HASH}`, "INTERNAL")
      )
    ).toBe(false);
    expect(isPendingReceiptApiError(new Error("Transaction receipt not found or still pending"))).toBe(false);
  });

  it("retries transient pending-receipt errors with configured delays and resolves on success", async () => {
    const delaysSeen: number[] = [];
    let attempts = 0;

    const result = await retryOnPendingReceipt(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new ApiClientError(
            400,
            `Transaction receipt not found or still pending: ${TX_HASH}`,
            "VALIDATION_ERROR"
          );
        }
        return "synced";
      },
      {
        retryDelaysMs: [100, 200, 300],
        sleep: async (ms) => {
          delaysSeen.push(ms);
        },
      }
    );

    expect(result).toBe("synced");
    expect(attempts).toBe(3);
    expect(delaysSeen).toEqual([100, 200]);
  });

  it("does not retry non-pending errors and throws after exhausting retries", async () => {
    let revertedAttempts = 0;
    await expect(
      retryOnPendingReceipt(
        async () => {
          revertedAttempts += 1;
          throw new ApiClientError(
            400,
            `Submitted transaction reverted on-chain: ${TX_HASH}`,
            "VALIDATION_ERROR"
          );
        },
        { retryDelaysMs: [10, 20], sleep: async () => {} }
      )
    ).rejects.toThrow("reverted on-chain");
    expect(revertedAttempts).toBe(1);

    let exhaustedAttempts = 0;
    await expect(
      retryOnPendingReceipt(
        async () => {
          exhaustedAttempts += 1;
          throw new ApiClientError(
            400,
            `Transaction receipt not found or still pending: ${TX_HASH}`,
            "VALIDATION_ERROR"
          );
        },
        { retryDelaysMs: [10, 20], sleep: async () => {} }
      )
    ).rejects.toThrow("Transaction receipt not found or still pending");
    expect(exhaustedAttempts).toBe(3);
  });

  it("automatically retries syncDealState and bindDealTransaction when backend waits for confirmations", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const jsonResponse = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => body,
      }) as Response;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(400, {
          code: "VALIDATION_ERROR",
          message: `Transaction receipt not found or still pending: ${TX_HASH}`,
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { tradeId: TRADE_ID, status: "FUNDED" }))
      .mockResolvedValueOnce(
        jsonResponse(400, {
          code: "VALIDATION_ERROR",
          message: `Transaction receipt not found or still pending on-chain: ${TX_HASH}`,
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { tradeId: TRADE_ID, status: "CREATED", onChainBound: true }));

    vi.stubGlobal("fetch", fetchMock);

    const syncPromise = syncDealState(TRADE_ID, TX_HASH);
    await vi.runAllTimersAsync();
    const synced = await syncPromise;
    expect(synced.status).toBe("FUNDED");

    const bindPromise = bindDealTransaction(TRADE_ID, TX_HASH);
    await vi.runAllTimersAsync();
    const bound = await bindPromise;
    expect(bound.onChainBound).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });
});

describe("bearer token persistence across tabs", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setBearerToken(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setBearerToken(null);
    vi.unstubAllGlobals();
  });

  it("persists bearer token in localStorage, attaches Authorization header, and clears on 401", async () => {
    setBearerToken("jwt-cross-tab-token");
    expect(window.localStorage.getItem(BEARER_TOKEN_KEY)).toBe("jwt-cross-tab-token");
    expect(window.sessionStorage.getItem(BEARER_TOKEN_KEY)).toBeNull();
    expect(resolveBearerToken()).toBe("jwt-cross-tab-token");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ code: "UNAUTHORIZED", message: "Expired" }),
      } as Response);

    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/v1/auth/me");
    const firstCallHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstCallHeaders["Authorization"]).toBe("Bearer jwt-cross-tab-token");

    await expect(apiRequest("/api/v1/auth/me")).rejects.toThrow("Expired");
    expect(window.localStorage.getItem(BEARER_TOKEN_KEY)).toBeNull();
    expect(resolveBearerToken()).toBeNull();
  });

  it("migrates legacy sessionStorage bearer token into localStorage", () => {
    window.sessionStorage.setItem(BEARER_TOKEN_KEY, "legacy-session-jwt");
    expect(resolveBearerToken()).toBe("legacy-session-jwt");
    expect(window.localStorage.getItem(BEARER_TOKEN_KEY)).toBe("legacy-session-jwt");
    expect(window.sessionStorage.getItem(BEARER_TOKEN_KEY)).toBeNull();
  });

  it("falls back to in-memory token when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    setBearerToken("memory-only-jwt");
    expect(resolveBearerToken()).toBe("memory-only-jwt");
  });
});
