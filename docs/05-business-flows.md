# Core Business Flows & Sequences

## 1. Cooperative Trade Flow (Buyer, Seller, Frontend, API & SafeDealEscrow)

```mermaid
sequenceDiagram
    actor Seller
    actor Buyer
    participant FE as Frontend (/create & /deals/:id)
    participant API as Rust Axum API
    participant SC as SafeDealEscrow (Avalanche)

    Seller->>FE: Connect Wallet & Sign SIWE (EIP-4361)
    FE->>API: POST /api/v1/auth/nonce + /verify
    API-->>FE: safedeal_session (HttpOnly) + safedeal_csrf + accessToken

    Seller->>FE: Select SEApp UIT Template or fill deal parameters & terms
    FE->>API: POST /api/v1/deals/drafts
    API-->>FE: tradeId + RFC 8785 termsHash (DRAFT)
    FE->>FE: Compute client canonical termsHash (Web Crypto SHA-256) & assert equality
    Note over FE: Persist Step 2 draft + txHash in sessionStorage (reload-safe recovery)

    Seller->>SC: createTrade(tradeId, buyer/0x0, arbiter, amount, termsHash, deadlines, window)
    FE->>API: POST /api/v1/deals/{tradeId}/bind-tx { txHash }
    API->>SC: Inspect TradeCreated receipt & getTrade snapshot
    API-->>FE: Status -> CREATED (clear Step 2 draft cache)

    Note over Seller,Buyer: Share deal link /deals/{tradeId} (verifiable in Chrome Extension Side Panel)
    Buyer->>SC: fundTrade(tradeId) payable { value == amount }
    FE->>API: POST /api/v1/deals/{tradeId}/sync { txHash }
    API-->>FE: Status -> FUNDED (open buyer locked if preassignedBuyer == address(0))

    Seller->>SC: markDelivered(tradeId)
    FE->>API: POST /api/v1/deals/{tradeId}/sync { txHash }
    API-->>FE: Status -> DELIVERED

    Buyer->>SC: releaseFunds(tradeId)
    SC-->>SC: _claimableBalances[seller] += amount
    FE->>API: POST /api/v1/deals/{tradeId}/sync { txHash }
    API-->>FE: Status -> RELEASED (settled = true)

    Seller->>SC: withdraw()
    SC-->>Seller: Native AVAX transferred cleanly
```

## 2. Dispute, Magic-Byte Evidence & 2-of-3 Multi-Party Consensus (+ 14-Day Timeout) Sequence

```mermaid
sequenceDiagram
    actor Seller
    actor Buyer
    actor Arbiter
    participant FE as Frontend (/deals/:id, /disputes/:id, /arbiter)
    participant API as Rust Axum API
    participant SC as SafeDealEscrow

    Note over Buyer,SC: Deal is FUNDED (either party) or DELIVERED (Buyer anytime; Seller after inspectionWindow)
    Buyer->>SC: openDispute(tradeId)
    FE->>API: POST /api/v1/deals/{tradeId}/disputes { reason, summary, txHash }
    API->>SC: Verify on-chain status == DISPUTED (or backfill auto-indexed dispute)
    API-->>FE: Dispute created (OPEN, /disputes/{id})

    par Private Multipart Evidence Upload
        Buyer->>FE: Upload PNG/JPEG/PDF/TXT screenshot
        FE->>API: POST /api/v1/disputes/{id}/evidence (with X-CSRF-Token / Bearer)
        API->>API: Check MIME allowlist + Magic Bytes + Size -> Store UUID key + SHA-256
    and Seller Rebuttal Evidence
        Seller->>FE: Upload counter-evidence
        FE->>API: POST /api/v1/disputes/{id}/evidence
    end

    Arbiter->>FE: Open /arbiter -> Inspect termsHash & download evidence (SHA-256 verified Blob)
    Arbiter->>SC: submitResolutionVote(tradeId, buyerAmountWei, sellerAmountWei)
    Note over SC: Requires buyerAmountWei + sellerAmountWei == trade.amount (Vote 1 of 3 recorded)
    FE->>API: POST /api/v1/disputes/{id}/votes { txHash, rationale }
    API-->>FE: Vote 1 recorded (Dispute remains OPEN awaiting 2nd matching vote)

    alt 2-of-3 Consensus Reached (Buyer or Seller agrees with Arbiter split, or Buyer + Seller agree directly)
        Buyer->>SC: submitResolutionVote(tradeId, buyerAmountWei, sellerAmountWei)
        Note over SC: 2-of-3 matching proposalHash! Emits DisputeVoteSubmitted + DisputeResolved
        SC-->>SC: _claimableBalances[buyer] += buyerAmountWei; _claimableBalances[seller] += sellerAmountWei
        FE->>API: POST /api/v1/disputes/{id}/votes { txHash, rationale }
        API->>SC: Verify DisputeResolved receipt & split amounts
        API-->>FE: Dispute -> RESOLVED, Deal -> RESOLVED
    else 14-Day Stalemate Fallback (block.timestamp >= disputedAt + 14 days)
        Buyer->>SC: resolveDisputeByTimeout(tradeId)
        Note over SC: Deterministic 50/50 split (buyerAmount = amount / 2, sellerAmount = amount - buyerAmount)
        SC-->>SC: _claimableBalances[buyer] += buyerAmount; _claimableBalances[seller] += sellerAmount
        FE->>API: POST /api/v1/disputes/{id}/timeout { txHash, rationale }
        API->>SC: Verify DisputeResolvedByTimeout receipt
        API-->>FE: Dispute -> RESOLVED, Deal -> RESOLVED
    end

    par Independent Pull Withdrawals
        Buyer->>SC: withdraw()
        SC-->>Buyer: Transfers buyerAmountWei
    and
        Seller->>SC: withdraw()
        SC-->>Seller: Transfers sellerAmountWei
    end
```

## 3. Reload-Safe `/create` Transaction Recovery

[`CreateDealPage.tsx`](../frontend/src/pages/CreateDealPage.tsx) + [`useCreateDraftPersistence.ts`](../frontend/src/features/deals/hooks/useCreateDraftPersistence.ts) guard sellers against accidental double `createTrade` submission or lost drafts on page reload:
- **Seller-Scoped Persistence**: Stores `previewDraft`, `clientTermsHash`, and `submittedCreateTxHash` in `sessionStorage` keyed per seller wallet (`safedeal:create-draft:<seller>`).
- **Pending Receipt Recovery**: If the browser reloads while `createTrade` is pending confirmation, `CreateDealPage` resumes `waitForHash(pendingTx.txHash)` automatically without re-invoking the wallet.
- **Confirmed Pre-Bind Retry**: If `bind-tx` returns `503` or offline error after on-chain confirmation, `/create` restores Step 2 with **Retry Backend Binding** (never calling `createTrade` again).
- **Clean Reset**: Draft state clears automatically upon `bind-tx` success or explicit **Edit Draft** cancellation (disabled once a tx hash exists).
