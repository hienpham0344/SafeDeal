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

export function loadPersistedCreateDraft(sellerAddress: string | undefined): PersistedCreateDraft | null {
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
      const submittedHash = isHex32(parsed.submittedCreateTxHash) ? parsed.submittedCreateTxHash : null;
      return {
        sellerAddress: parsed.sellerAddress,
        previewDraft: parsed.previewDraft,
        clientTermsHash: parsed.clientTermsHash,
        submittedCreateTxHash: submittedHash,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      };
    }
    return null;
  } catch {
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

export function useCreateDraftPersistence(sellerAddress: string | undefined) {
  const [persistedDraft, setPersistedDraft] = useState<PersistedCreateDraft | null>(() =>
    loadPersistedCreateDraft(sellerAddress)
  );

  useEffect(() => {
    setPersistedDraft(loadPersistedCreateDraft(sellerAddress));
  }, [sellerAddress]);

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
