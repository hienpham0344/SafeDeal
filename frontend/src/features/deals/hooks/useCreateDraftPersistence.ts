import { useCallback, useEffect, useState } from "react";
import { appConfig } from "@/config/app.config";
import type { CreateDealDraftResponse } from "@/types/api";

export interface PersistedCreateDraft {
  readonly sellerAddress: string;
  readonly previewDraft: CreateDealDraftResponse;
  readonly clientTermsHash: `0x${string}`;
  readonly submittedCreateTxHash: `0x${string}` | null;
  readonly updatedAt: string;
}

function buildDraftStorageKey(sellerAddress: string): string {
  return `${appConfig.transactions.createDraftStoragePrefix}${sellerAddress.toLowerCase()}`;
}

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function pruneExpiredDrafts(ttlMs: number = DEFAULT_DRAFT_TTL_MS): number {
  if (typeof window === "undefined") return 0;
  let prunedCount = 0;
  try {
    const prefix = appConfig.transactions.createDraftStoragePrefix;
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
        const parsed = JSON.parse(raw) as Partial<PersistedCreateDraft>;
        const updatedAt = typeof parsed.updatedAt === "string" ? Date.parse(parsed.updatedAt) : NaN;
        if (isNaN(updatedAt) || now - updatedAt > ttlMs) {
          window.sessionStorage.removeItem(key);
          prunedCount++;
        }
      } catch {
        window.sessionStorage.removeItem(key);
        prunedCount++;
      }
    }
  } catch {
    // Ignore storage iteration errors
  }
  return prunedCount;
}

export function loadPersistedCreateDraft(
  sellerAddress: string | undefined,
  ttlMs: number = DEFAULT_DRAFT_TTL_MS
): PersistedCreateDraft | null {
  if (typeof window === "undefined" || !sellerAddress) return null;
  try {
    const raw = window.sessionStorage.getItem(buildDraftStorageKey(sellerAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCreateDraft>;
    if (
      typeof parsed.sellerAddress === "string" &&
      parsed.sellerAddress.toLowerCase() === sellerAddress.toLowerCase() &&
      parsed.previewDraft &&
      typeof parsed.previewDraft === "object" &&
      isHex32(parsed.previewDraft.tradeId) &&
      isHex32(parsed.clientTermsHash)
    ) {
      const updatedAtStr = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
      const parsedTime = updatedAtStr ? Date.parse(updatedAtStr) : NaN;
      if (isNaN(parsedTime) || Date.now() - parsedTime > ttlMs) {
        clearPersistedCreateDraft(sellerAddress);
        return null;
      }

      const submittedHash = isHex32(parsed.submittedCreateTxHash) ? parsed.submittedCreateTxHash : null;
      return {
        sellerAddress: parsed.sellerAddress,
        previewDraft: parsed.previewDraft,
        clientTermsHash: parsed.clientTermsHash,
        submittedCreateTxHash: submittedHash,
        updatedAt: updatedAtStr ?? new Date().toISOString(),
      };
    }
    clearPersistedCreateDraft(sellerAddress);
    return null;
  } catch {
    clearPersistedCreateDraft(sellerAddress);
    return null;
  }
}

export function savePersistedCreateDraft(sellerAddress: string, state: Omit<PersistedCreateDraft, "sellerAddress" | "updatedAt">): PersistedCreateDraft {
  const payload: PersistedCreateDraft = {
    sellerAddress,
    previewDraft: state.previewDraft,
    clientTermsHash: state.clientTermsHash,
    submittedCreateTxHash: state.submittedCreateTxHash,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(buildDraftStorageKey(sellerAddress), JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors in restricted browser modes
    }
  }
  return payload;
}

export function clearPersistedCreateDraft(sellerAddress: string | undefined): void {
  if (typeof window === "undefined" || !sellerAddress) return;
  try {
    window.sessionStorage.removeItem(buildDraftStorageKey(sellerAddress));
  } catch {
    // Ignore storage removal errors
  }
}

export function clearAllPersistedCreateDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = appConfig.transactions.createDraftStoragePrefix;
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
    // Ignore storage removal errors
  }
}

export function useCreateDraftPersistence(
  sellerAddress: string | undefined,
  ttlMs: number = DEFAULT_DRAFT_TTL_MS
) {
  const [persistedDraft, setPersistedDraft] = useState<PersistedCreateDraft | null>(() => {
    pruneExpiredDrafts(ttlMs);
    return loadPersistedCreateDraft(sellerAddress, ttlMs);
  });

  useEffect(() => {
    pruneExpiredDrafts(ttlMs);
    const next = loadPersistedCreateDraft(sellerAddress, ttlMs);
    setPersistedDraft((prev) => {
      if (
        prev &&
        next &&
        prev.sellerAddress === next.sellerAddress &&
        prev.previewDraft.tradeId === next.previewDraft.tradeId &&
        prev.clientTermsHash === next.clientTermsHash &&
        prev.submittedCreateTxHash === next.submittedCreateTxHash &&
        prev.updatedAt === next.updatedAt
      ) {
        return prev;
      }
      return next;
    });
  }, [sellerAddress, ttlMs]);

  const persistDraftState = useCallback(
    (state: {
      readonly previewDraft: CreateDealDraftResponse;
      readonly clientTermsHash: `0x${string}`;
      readonly submittedCreateTxHash: `0x${string}` | null;
    }) => {
      if (!sellerAddress) return;
      const saved = savePersistedCreateDraft(sellerAddress, state);
      setPersistedDraft(saved);
    },
    [sellerAddress]
  );

  const clearDraftState = useCallback(() => {
    clearPersistedCreateDraft(sellerAddress);
    setPersistedDraft(null);
  }, [sellerAddress]);

  const matchingPersistedDraft =
    persistedDraft &&
    sellerAddress &&
    persistedDraft.sellerAddress.toLowerCase() === sellerAddress.toLowerCase()
      ? persistedDraft
      : null;

  return {
    persistedDraft: matchingPersistedDraft,
    persistDraftState,
    clearDraftState,
  };
}
