# Security Architecture & Threat Model

SafeDeal operates on a **trust-minimized custody boundary**: backend API, database, RPC endpoints, and browser sessions are never permitted custody over user funds. Smart contract controls enforce solvency on Avalanche; Web2.5 security controls protect authentication integrity, terms verification, dispute evidence confidentiality, and availability.

## 1. On-Chain Threat Controls (`SafeDealEscrow.sol`)

- **Zero Admin Custody / Upgrade Risk**: Contract is non-upgradeable with no `owner`, `pause()`, or `sweep()` backdoor.
- **Pull-Payment Reentrancy & DoS Isolation**: `withdraw()` applies OpenZeppelin `ReentrancyGuard` and zero-before-transfer `Checks-Effects-Interactions`. Reverting receivers only affect their own `withdraw()`, never countersigning payouts.
- **Role Isolation**: Contract enforces `seller != arbiter`, `buyer != seller`, `buyer != arbiter`, and `arbiter != address(0)`.
- **Sum Invariant**: `resolveDispute` checks `buyerAmount <= trade.amount && sellerAmount == trade.amount - buyerAmount`, preventing overpayment or leftover dust lockup; `arbiter` receives `0`.
- **Direct Transfer Prevention**: `receive()` and `fallback()` revert immediately (`DirectTransfersNotAllowed`).

## 2. Backend & Web API Security Controls

| Threat Vector | Implemented Control | Primary Implementation |
|---|---|---|
| **Wallet Impersonation & Replay** | EIP-4361 (SIWE) message parsing checks domain, URI, chainId, expiry, and Secp256k1 `ecrecover` (low-`s` normalized via Web3j `Sign`). Challenges expire after `NONCE_TTL_SECONDS` and are consumed atomically once in SQL (`AuthNonceRepositoryAdapter.consumeOnce`). | `SiweAuthService`, `SiweMessageParser`, `Web3jSignatureVerifier` |
| **Session Theft via Browser XSS** | Signed HS256 JWT stored strictly in an `HttpOnly` cookie (`safedeal_session`) invisible to `document.cookie` / JavaScript. | `JwtSessionService`, `HttpSessionCookieAdapter` |
| **Cross-Site Request Forgery (CSRF)** | `DoubleSubmitCsrfFilter` enforces equality between `safedeal_csrf` cookie and `X-CSRF-Token` header on state-changing routes (`POST`, `PUT`, `PATCH`, `DELETE`). Exempt public pre-session auth initiation routes are guarded by SIWE wallet signatures & rate limiting. | `DoubleSubmitCsrfFilter`, `SecurityConfig` |
| **Auth Challenge/Verify Abuse** | `AuthRateLimitFilter` enforces sliding-window IP throttling on `/api/v1/auth/nonce` and `/api/v1/auth/verify` (`429 RATE_LIMITED`). Client keys use `HttpServletRequest.getRemoteAddr()` directly (ignoring raw spoofable `X-Forwarded-For` headers outside configured `server.forward-headers-strategy: framework` trusted proxies) with periodic memory eviction of expired windows. | `AuthRateLimitFilter` |
| **Weak Production Secrets / Misconfig** | `InfrastructureBeansConfig.authSecurityStartupValidator` fails startup in `prod` or `staging` profiles if `JWT_SECRET` contains placeholder words (`replace-with`, `placeholder`, `changeme`, `change-me`, `dev-only`, `test-only`, `example`), is `< 32` chars, `COOKIE_SECURE` is `false`, `CORS_ALLOWED_ORIGINS` contains `*` or loopback addresses, or `SIWE_DOMAIN`/`SIWE_URI`/`AVALANCHE_RPC_URL` use `localhost` / `127.0.0.1` / `[::1]`. | `InfrastructureBeansConfig`, `AuthSecurityProperties`, `CorsProperties` |
| **Off-Chain Terms Substitution** | Frontend (`canonical-terms.ts`) and backend (`CanonicalTermsHasher.java`) independently generate RFC 8785 Canonical JSON SHA-256 `termsHash`; `BindDealTransactionUseCase` & `SyncDealUseCase` verify equality against on-chain `TradeCreated` events and `getTrade` state. | `CanonicalTermsHasher`, `BindDealTransactionUseCase`, `SyncDealUseCase` |
| **DB Pool Exhaustion Under Slow RPC** | External Web3j RPC calls always execute outside database transactions (`TransactionOperations` encloses brief PostgreSQL reads/writes only). | `BindDealTransactionUseCase`, `SyncDealUseCase`, `ArbitrationUseCase`, `BlockchainEventIndexerService` |
| **Malicious File Upload / Path Traversal** | `LocalEvidenceStorageAdapter` enforces declared MIME allowlist (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`), **magic-byte signature inspection** (`89 50 4E 47 0D 0A 1A 0A`, `FF D8 FF`, `%PDF-`, UTF-8 non-null/non-blank), strict size bounds, UUID storage filenames, and canonical `Path.normalize().startsWith(rootDir)` containment. | `LocalEvidenceStorageAdapter` |
| **XSS / Sniffing via Evidence Downloads** | Downloads validate caller participation/arbiter ACL (`403` for non-actors) and send `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. | `DisputeController`, `DisputeUseCase` |
| **Information Leakage & Secret Hygiene** | `GlobalExceptionHandler` strips internal stack traces into structured `ApiErrorPayload` + `correlationId`. `.github/workflows/secrets-scan.yml` runs Gitleaks across commit history. | `GlobalExceptionHandler`, `secrets-scan.yml` |
