import { useCallback, useEffect, useState } from "react";
import { appConfig } from "@/config/app.config";

export interface PendingTxRecord {
  readonly txHash: `0x${string}`;
  readonly action: string;
  readonly startedAt: string;
}

function storageKey(scopeId: string): string {
  return `${appConfig.transactions.pendingStoragePrefix}${scopeId}`;
}

export function loadPendingTx(scopeId: string): PendingTxRecord | null {
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
      return {
        txHash: parsed.txHash as `0x${string}`,
        action: parsed.action,
        startedAt: parsed.startedAt ?? new Date().toISOString(),
      };
    }
    return null;
  } catch {
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

export function usePendingTxPersistence(scopeId: string) {
  const [pendingTx, setPendingTx] = useState<PendingTxRecord | null>(() => loadPendingTx(scopeId));

  useEffect(() => {
    setPendingTx(loadPendingTx(scopeId));
  }, [scopeId]);

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
