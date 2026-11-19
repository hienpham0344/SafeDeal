import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllPendingTxs,
  DEFAULT_PENDING_TX_TTL_MS,
  loadPendingTx,
  pruneExpiredPendingTxs,
  savePendingTx,
  usePendingTxPersistence,
} from "@/features/deals/hooks/usePendingTransactions";

const TX_HASH_1 = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const TX_HASH_2 = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

describe("usePendingTransactions with TTL expiration and cleanup", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("persists and loads fresh pending tx records within TTL", () => {
    savePendingTx("deal-1", {
      txHash: TX_HASH_1,
      action: "fundTrade",
      startedAt: new Date().toISOString(),
    });

    const loaded = loadPendingTx("deal-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.txHash).toBe(TX_HASH_1);
    expect(loaded?.action).toBe("fundTrade");
  });

  it("evicts expired and malformed pending tx entries automatically on load", () => {
    const expiredTs = new Date(Date.now() - (DEFAULT_PENDING_TX_TTL_MS + 5_000)).toISOString();
    window.sessionStorage.setItem(
      "safedeal:pending-tx:expired-deal",
      JSON.stringify({
        txHash: TX_HASH_1,
        action: "fundTrade",
        startedAt: expiredTs,
      })
    );

    expect(loadPendingTx("expired-deal")).toBeNull();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:expired-deal")).toBeNull();

    window.sessionStorage.setItem("safedeal:pending-tx:corrupt", "{bad-json");
    expect(loadPendingTx("corrupt")).toBeNull();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:corrupt")).toBeNull();
  });

  it("prunes expired entries while keeping fresh entries and clears all on sign-out", () => {
    const expiredTs = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const freshTs = new Date().toISOString();

    window.sessionStorage.setItem(
      "safedeal:pending-tx:old",
      JSON.stringify({ txHash: TX_HASH_1, action: "markDelivered", startedAt: expiredTs })
    );
    window.sessionStorage.setItem(
      "safedeal:pending-tx:fresh",
      JSON.stringify({ txHash: TX_HASH_2, action: "releaseFunds", startedAt: freshTs })
    );
    window.sessionStorage.setItem("unrelated-key", "keep-me");

    expect(pruneExpiredPendingTxs()).toBe(1);
    expect(window.sessionStorage.getItem("safedeal:pending-tx:old")).toBeNull();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:fresh")).not.toBeNull();

    clearAllPendingTxs();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:fresh")).toBeNull();
    expect(window.sessionStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("hook stores, loads, and clears scoped pending tx", () => {
    const { result } = renderHook(() => usePendingTxPersistence("trade-abc"));
    expect(result.current.pendingTx).toBeNull();

    act(() => {
      result.current.setPending(TX_HASH_1, "createTrade");
    });
    expect(result.current.pendingTx?.txHash).toBe(TX_HASH_1);

    act(() => {
      result.current.clearPending();
    });
    expect(result.current.pendingTx).toBeNull();
    expect(window.sessionStorage.getItem("safedeal:pending-tx:trade-abc")).toBeNull();
  });
});
