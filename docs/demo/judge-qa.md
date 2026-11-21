# Judge Technical Q&A

**Q1: Can the SafeDeal backend or deployer ever freeze, censor, or sweep locked AVAX?**
No. `SafeDealEscrow.sol` has no owner, admin role, pause toggle, or sweep function. Only `releaseFunds` (buyer), `refundBySeller` (seller), `refundAfterDeadline` (buyer after deadline), `submitResolutionVote` (2-of-3 consensus across `[buyer, seller, arbiter]` enforcing `buyerAmount + sellerAmount == trade.amount`), or `resolveDisputeByTimeout` (deterministic 50/50 split after 14 days) can credit `_claimableBalances`. Recipients call `withdraw()` directly on-chain.

**Q2: What happens if a malicious smart contract acts as buyer/seller and reverts in `receive()` during split arbitration?**
Push transfers would deadlock funds. SafeDeal isolates payouts via **pull-payment withdrawals** (`_claimableBalances` + `withdraw()`). Even if one party's contract deliberately reverts on transfer, dispute settlement completes cleanly and the honest counterparty withdraws their share normally.

**Q3: How do you guarantee off-chain readable deal descriptions match what was signed on-chain?**
Both browser (`canonical-terms.ts`) and Rust backend (`crates/domain/src/canonical_terms.rs`) serialize the commercial terms object into identical RFC 8785 Canonical JSON and compute SHA-256 (`termsHash`). `createTrade` commits `termsHash` on-chain, and `BindDealTransactionUseCase` / `SyncDealUseCase` verify equality against on-chain logs and `getTrade` before binding or reconciling deals.

**Q4: Why do you store JWT sessions in `HttpOnly` cookies paired with `X-CSRF-Token` instead of `localStorage`?**
Keeping session tokens solely in `localStorage` without CSRF protection weakens browser security. SafeDeal sets an `HttpOnly` session cookie paired with `safedeal_csrf` + `X-CSRF-Token` Double-Submit verification on mutations (and supports cross-origin bearer tokens for decoupled Firebase/Railway deployments).

**Q5: How do you prevent an RPC outage or spoofed HTTP headers from degrading backend stability or auth security?**
1. `AlloyBlockchainGateway` JSON-RPC calls run explicitly **outside** PostgreSQL transactions (`UnitOfWork::in_tx`) so slow RPC responses never exhaust `sqlx::PgPool` connections.
2. `AuthRateLimitState` keys sliding-window limits on peer `SocketAddr` by default (`AUTH_TRUST_PROXY_HEADERS=false`, ignoring untrusted `X-Forwarded-For` headers) with bounded map eviction.

**Q6: What prevents malicious polyglot image uploads or non-participants from reading private dispute evidence?**
`LocalEvidenceStorage` (and `S3EvidenceStorage`) validates declared MIME types (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`), verifies binary **magic-byte signatures**, writes UUID filenames with path-traversal/symlink containment checks, and serves downloads exclusively to the trade's `seller`, `buyer`, or `arbiter` with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`.

**Q7: What if the seller refreshes `/create` mid-transaction or backend `bind-tx` returns `503`?**
`CreateDealPage` persists the drafted preview, `clientTermsHash`, and `submittedCreateTxHash` per seller address in `sessionStorage` alongside pending tx tracking. On reload, it either waits for the existing tx receipt or presents **Retry Backend Binding**, never invoking `createTrade` twice.
