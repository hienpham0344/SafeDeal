import { useCallback, useEffect, useState } from "react";
import { appConfig } from "@/config/app.config";

export interface PendingTxRecord {
  readonly txHash: `0x${string}`;
  readonly action: string;
  readonly startedAt: string;
}

export const DEFAULT_PENDING_TX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function storageKey(scopeId: string): string {
  return `${appConfig.transactions.pendingStoragePrefix}${scopeId}`;
}

export function pruneExpiredPendingTxs(ttlMs: number = DEFAULT_PENDING_TX_TTL_MS): number {
  if (typeof window === "undefined") return 0;
  let pruned = 0;
  try {
    const prefix = appConfig.transactions.pendingStoragePrefix;
    const matchingKeys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(prefix)) {
        matchingKeys.push(key);
      }
    }
    const now = Date.now();
    for (const key of matchingKeys) {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Partial<PendingTxRecord>;
        const startedAtMs = typeof parsed.startedAt === "string" ? Date.parse(parsed.startedAt) : NaN;
        if (
          typeof parsed.txHash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(parsed.txHash) ||
          typeof parsed.action !== "string" ||
          Number.isNaN(startedAtMs) ||
          now - startedAtMs > ttlMs
        ) {
          window.sessionStorage.removeItem(key);
          pruned++;
        }
      } catch {
        window.sessionStorage.removeItem(key);
        pruned++;
      }
    }
  } catch {
    // Ignore storage iteration errors
  }
  return pruned;
}

export function loadPendingTx(
  scopeId: string,
  ttlMs: number = DEFAULT_PENDING_TX_TTL_MS
): PendingTxRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(scopeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTxRecord>;
    if (
      typeof parsed.txHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(parsed.txHash) &&
      typeof parsed.action === "string"
    ) {
      const startedAtStr = typeof parsed.startedAt === "string" ? parsed.startedAt : null;
      const startedAtMs = startedAtStr ? Date.parse(startedAtStr) : NaN;
      if (Number.isNaN(startedAtMs) || Date.now() - startedAtMs > ttlMs) {
        clearPendingTx(scopeId);
        return null;
      }
      return {
        txHash: parsed.txHash as `0x${string}`,
        action: parsed.action,
        startedAt: startedAtStr ?? new Date().toISOString(),
      };
    }
    clearPendingTx(scopeId);
    return null;
  } catch {
    clearPendingTx(scopeId);
    return null;
  }
}

export function savePendingTx(scopeId: string, record: PendingTxRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(scopeId), JSON.stringify(record));
  } catch {
    // Ignore storage quota issues in restricted browsers
  }
}

export function clearPendingTx(scopeId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(scopeId));
  } catch {
    // Ignore
  }
}

export function clearAllPendingTxs(): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = appConfig.transactions.pendingStoragePrefix;
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

export function usePendingTxPersistence(
  scopeId: string,
  ttlMs: number = DEFAULT_PENDING_TX_TTL_MS
) {
  const [pendingTx, setPendingTx] = useState<PendingTxRecord | null>(() => {
    pruneExpiredPendingTxs(ttlMs);
    return loadPendingTx(scopeId, ttlMs);
  });

  useEffect(() => {
    pruneExpiredPendingTxs(ttlMs);
    const next = loadPendingTx(scopeId, ttlMs);
    setPendingTx((prev) => {
      if (
        prev &&
        next &&
        prev.txHash === next.txHash &&
        prev.action === next.action &&
        prev.startedAt === next.startedAt
      ) {
        return prev;
      }
      return next;
    });
  }, [scopeId, ttlMs]);

  const setPending = useCallback(
    (txHash: `0x${string}`, action: string) => {
      const record: PendingTxRecord = {
        txHash,
        action,
        startedAt: new Date().toISOString(),
      };
      savePendingTx(scopeId, record);
      setPendingTx(record);
    },
    [scopeId]
  );

  const clearPending = useCallback(() => {
    clearPendingTx(scopeId);
    setPendingTx(null);
  }, [scopeId]);

  return { pendingTx, setPending, clearPending };
}
