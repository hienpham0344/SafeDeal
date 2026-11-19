import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllPersistedCreateDrafts,
  DEFAULT_DRAFT_TTL_MS,
  loadPersistedCreateDraft,
  pruneExpiredDrafts,
  savePersistedCreateDraft,
  useCreateDraftPersistence,
} from "@/features/deals/hooks/useCreateDraftPersistence";
import type { CreateDealDraftResponse, DealDetail } from "@/types/api";

const SELLER_1 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SELLER_2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TRADE_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const TERMS_HASH = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

const mockDealDetail: DealDetail = {
  tradeId: TRADE_ID,
  title: "Test Deal",
  description: "Test Deal Description",
  seller: SELLER_1 as `0x${string}`,
  buyer: null,
  arbiter: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  amountWei: "1000000000000000000",
  termsHash: TERMS_HASH,
  fundingDeadline: "2027-01-01T00:00:00Z",
  deliveryDeadline: "2027-01-08T00:00:00Z",
  inspectionWindowSeconds: 86400,
  status: "DRAFT",
  onChainBound: false,
  settled: false,
  deliveredAt: null,
  fundedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  disputeId: null,
  terms: "Terms",
  canonicalTermsJson: "{}",
  chainId: 31337,
  contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  createTxHash: null,
};

const mockPreviewDraft: CreateDealDraftResponse = {
  deal: mockDealDetail,
  tradeId: TRADE_ID,
  termsHash: TERMS_HASH,
  canonicalTermsJson: "{}",
  contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  chainId: 31337,
};

describe("useCreateDraftPersistence with TTL expiration", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("saves and loads fresh drafts within TTL", () => {
    savePersistedCreateDraft(SELLER_1, {
      previewDraft: mockPreviewDraft,
      clientTermsHash: TERMS_HASH,
      submittedCreateTxHash: null,
    });

    const loaded = loadPersistedCreateDraft(SELLER_1);
    expect(loaded).not.toBeNull();
    expect(loaded?.sellerAddress).toBe(SELLER_1);
    expect(loaded?.previewDraft.tradeId).toBe(TRADE_ID);
  });

  it("prunes and returns null when draft is older than TTL", () => {
    const expiredTimestamp = new Date(Date.now() - (DEFAULT_DRAFT_TTL_MS + 1000)).toISOString();
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_1.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER_1,
        previewDraft: mockPreviewDraft,
        clientTermsHash: TERMS_HASH,
        submittedCreateTxHash: null,
        updatedAt: expiredTimestamp,
      })
    );

    const loaded = loadPersistedCreateDraft(SELLER_1);
    expect(loaded).toBeNull();
    // Storage must be automatically cleaned
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();
  });

  it("supports custom TTL thresholds", () => {
    const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_1.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER_1,
        previewDraft: mockPreviewDraft,
        clientTermsHash: TERMS_HASH,
        submittedCreateTxHash: null,
        updatedAt: halfHourAgo,
      })
    );

    // 15 min TTL should expire it
    const expired = loadPersistedCreateDraft(SELLER_1, 15 * 60 * 1000);
    expect(expired).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();
  });

  it("evicts corrupted or non-hex drafts gracefully", () => {
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_1.toLowerCase()}`,
      "not-even-valid-json"
    );
    expect(loadPersistedCreateDraft(SELLER_1)).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();

    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_1.toLowerCase()}`,
      JSON.stringify({ sellerAddress: SELLER_1, previewDraft: { tradeId: "bad-hex" } })
    );
    expect(loadPersistedCreateDraft(SELLER_1)).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();
  });

  it("pruneExpiredDrafts cleans multiple expired entries while preserving fresh ones", () => {
    const expiredTimestamp = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const freshTimestamp = new Date().toISOString();

    // Expired draft for SELLER_1
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_1.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER_1,
        previewDraft: mockPreviewDraft,
        clientTermsHash: TERMS_HASH,
        submittedCreateTxHash: null,
        updatedAt: expiredTimestamp,
      })
    );

    // Fresh draft for SELLER_2
    window.sessionStorage.setItem(
      `safedeal:create-draft:${SELLER_2.toLowerCase()}`,
      JSON.stringify({
        sellerAddress: SELLER_2,
        previewDraft: { ...mockPreviewDraft, deal: { ...mockDealDetail, seller: SELLER_2 as `0x${string}` } },
        clientTermsHash: TERMS_HASH,
        submittedCreateTxHash: null,
        updatedAt: freshTimestamp,
      })
    );

    const pruned = pruneExpiredDrafts();
    expect(pruned).toBe(1);
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_2.toLowerCase()}`)).not.toBeNull();
  });

  it("useCreateDraftPersistence hook handles persistence, auto-expiration, and clearing", () => {
    const { result, rerender } = renderHook(
      ({ address }) => useCreateDraftPersistence(address),
      { initialProps: { address: SELLER_1 } }
    );

    expect(result.current.persistedDraft).toBeNull();

    act(() => {
      result.current.persistDraftState({
        previewDraft: mockPreviewDraft,
        clientTermsHash: TERMS_HASH,
        submittedCreateTxHash: null,
      });
    });

    expect(result.current.persistedDraft?.previewDraft.tradeId).toBe(mockPreviewDraft.tradeId);

    // Clear draft
    act(() => {
      result.current.clearDraftState();
    });

    expect(result.current.persistedDraft).toBeNull();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();

    // Switching address
    rerender({ address: SELLER_2 });
    expect(result.current.persistedDraft).toBeNull();
  });

  it("clearAllPersistedCreateDrafts removes all draft keys without affecting unrelated storage keys", () => {
    savePersistedCreateDraft(SELLER_1, {
      previewDraft: mockPreviewDraft,
      clientTermsHash: TERMS_HASH,
      submittedCreateTxHash: null,
    });
    window.sessionStorage.setItem("other-app-key", "preserve");

    clearAllPersistedCreateDrafts();
    expect(window.sessionStorage.getItem(`safedeal:create-draft:${SELLER_1.toLowerCase()}`)).toBeNull();
    expect(window.sessionStorage.getItem("other-app-key")).toBe("preserve");
  });
});
