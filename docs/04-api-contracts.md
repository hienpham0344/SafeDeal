# REST API Contracts & Security Semantics

Base path: `/api/v1` · Canonical OpenAPI 3 specification: [`docs/openapi.json`](./openapi.json) (continuously verified against the `utoipa`-generated `/v3/api-docs` in [`openapi_contract.rs`](../backend/tests/openapi_contract.rs)).

## 1. Dual-Mode Authentication, Session Cookies, CSRF & Bearer Fallback

- **Session Cookie (`safedeal_session`)**: Signed `HttpOnly` HS256 JWT issued upon valid EIP-4361 SIWE signature verification (`POST /api/v1/auth/verify`). JavaScript cannot read this cookie.
- **Double-Submit CSRF (`safedeal_csrf` + `X-CSRF-Token`)**: Every cookie-authenticated mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) must supply the `safedeal_csrf` cookie value identically inside the `X-CSRF-Token` HTTP header, enforced by `csrf_protection_middleware`.
- **Cross-Origin `Authorization: Bearer` Fallback**: When the frontend (`https://avalanche-9b099.web.app` on Firebase Hosting) and backend (`https://safedeal-production.up.railway.app` on Railway) run across different top-level domains where browsers block third-party cookies (Safari ITP / Chrome 3PCD / Brave), `/api/v1/auth/verify` also returns `accessToken` in the JSON body and the frontend sends `Authorization: Bearer <token>` on API calls and authenticated Blob evidence downloads (`downloadAuthenticatedAttachment`).

## 2. Endpoint Reference

### System & Readiness

| Method & Path | Auth | Success Status | Response / Behavior |
|---|---|---|---|
| `GET /api/v1/health` | Public | `200 OK` | Liveness payload: `{ status: "UP", service, chainId, chainName, escrowContractConfigured }` |
| `GET /api/v1/health/ready` | Public | `200 OK` / `503 Service Unavailable` | Dependency readiness probe returning `ReadinessStatusResponse` (`status: "READY" \| "NOT_READY"`, `databaseConnected`, `evidenceStorageReady`, `siweConfigured`, `blockchainEnabled`, `escrowContractConfigured`, `chainId`). Returns HTTP `503` whenever DB connectivity (`SELECT 1`), evidence directory writability, SIWE settings, or enabled contract configuration fail. |
| `GET /actuator/health/readiness` | Public | `200 OK` | Container-orchestrator compatible readiness alias |

### Authentication (SIWE EIP-4361)

| Method & Path | Auth & Guard | Body | Response |
|---|---|---|---|
| `POST /api/v1/auth/nonce` | Public · Peer-IP Rate Limit (`429 RATE_LIMITED`) | `{ address, chainId }` | `{ nonce, domain, uri, chainId, issuedAt, expirationTime, statement, message }` |
| `POST /api/v1/auth/verify` | Public · Peer-IP Rate Limit | `{ message, signature }` | Sets `safedeal_session` (`HttpOnly`) & `safedeal_csrf`; returns `{ address, chainId, authenticatedAt, csrfToken, accessToken }` |
| `GET /api/v1/auth/me` | Authenticated | — | `200` `{ address, chainId, authenticatedAt, csrfToken }` (or `401`) |
| `POST /api/v1/auth/logout` | Cookie clear | — | `204 No Content` |

### Deals

| Method & Path | Auth & Role | Request Body | Behavior & Response |
|---|---|---|---|
| `POST /api/v1/deals/drafts` | Auth + CSRF/Bearer | `CreateDraftRequest` | Computes `tradeId` & RFC 8785 `termsHash`; returns `201` `CreateDraftResponse` (`DRAFT`) |
| `POST /api/v1/deals/{tradeId}/bind-tx` | Auth + CSRF/Bearer · Seller only | `{ txHash }` | Inspects on-chain `TradeCreated` receipt + `getTrade`, verifies `termsHash`/`amountWei`/`arbiter`, binds deal (`CREATED`) |
| `POST /api/v1/deals/{tradeId}/sync` | Auth + CSRF/Bearer · Viewer/Participant | `{ txHash? }` | Verifies optional tx receipt & fetches authoritative on-chain snapshot; advances forward status and auto-creates/updates dispute projections |
| `GET /api/v1/deals` | Auth | Query: `role`, `status`, `page`, `size` | Returns caller-scoped `PaginatedResponse<DealSummaryResponse>` |
| `GET /api/v1/deals/{tradeId}` | Auth · Participant/Arbiter or Open Buyer (`CREATED` & bound) | — | Returns `DealDetailResponse` |
| `GET /api/v1/deals/{tradeId}/history` | Auth · Viewer | — | Returns `{ events: DealEventResponse[], transactions: BlockchainTransactionResponse[] }` |

### Disputes, Private Evidence & 2-of-3 Consensus / 14-Day Timeout

| Method & Path | Auth & Role | Request Format | Behavior & Response |
|---|---|---|---|
| `POST /api/v1/deals/{tradeId}/disputes` | Auth + CSRF/Bearer · Seller or Buyer | `{ reason, summary, txHash? }` | Verifies on-chain `DISPUTED` state, creates `Dispute` (`OPEN`) or backfills auto-indexed on-chain dispute metadata -> `201 Created` |
| `GET /api/v1/disputes/{disputeId}` | Auth · Seller, Buyer, or Arbiter | — | Returns `DisputeDetailResponse` including `disputedAt`, `disputeTimeoutSeconds` (`1209600`), `canResolveByTimeout`, `requiredConsensusVotes` (`2`), and `votes: DisputeVoteResponse[]` (`403` for non-participants) |
| `GET /api/v1/disputes/{disputeId}/evidence` | Auth · Seller, Buyer, or Arbiter | — | Returns `DisputeEvidenceResponse[]` |
| `POST /api/v1/disputes/{disputeId}/evidence` | Auth + CSRF/Bearer · Seller or Buyer (`OPEN` dispute) | `multipart/form-data` (`title`, `notes`, optional `file`) | Enforces MIME allowlist (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`), magic-byte inspection, max size, and SHA-256 hash -> `201 Created` |
| `GET /api/v1/disputes/{disputeId}/evidence/{evidenceId}/download` | Auth · Seller, Buyer, or Arbiter | — | Verifies SHA-256 byte integrity on disk/S3 and streams binary attachment with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` |
| `POST /api/v1/disputes/{disputeId}/votes` | Auth + CSRF/Bearer · Buyer, Seller, or Arbiter | `{ txHash, rationale? }` | Verifies on-chain `submitResolutionVote(tradeId, buyerAmount, sellerAmount)` receipt (`DisputeVoteSubmitted` + optional `DisputeResolved`), records voter's split proposal in `dispute_votes`, and transitions deal/dispute to `RESOLVED` once 2-of-3 consensus matches |
| `POST /api/v1/disputes/{disputeId}/timeout` | Auth + CSRF/Bearer · Buyer, Seller, or Arbiter | `{ txHash, rationale? }` | Verifies on-chain `resolveDisputeByTimeout(tradeId)` receipt (`DisputeResolvedByTimeout`) after 14-day `DISPUTE_TIMEOUT`, recording the deterministic 50/50 split and transitioning deal/dispute to `RESOLVED` |

### Arbitration Console

| Method & Path | Auth & Role | Request Body | Behavior & Response |
|---|---|---|---|
| `GET /api/v1/arbitration/disputes` | Auth | — | Returns all disputes assigned to caller as `arbiter` (including votes and timeout status) |
| `POST /api/v1/arbitration/disputes/{disputeId}/resolution` | Auth + CSRF/Bearer · Assigned Arbiter (or Consensus Caller) | `{ txHash, rationale }` | Records an on-chain 2-of-3 consensus vote/resolution (`submitResolutionVote` -> `DisputeVoteSubmitted` / `DisputeResolved`) or 14-day timeout (`resolveDisputeByTimeout`), verifying sum invariant `buyerAmount + sellerAmount == trade.amount` |

## 3. Standardized Error Envelope (`ApiErrorPayload`)

All `4xx` / `5xx` errors are mapped by `ApiError` (`crates/presentation/src/error.rs`), excluding internal stack traces and returning consistent JSON:

```json
{
  "code": "REQUEST_VALIDATION_FAILED",
  "message": "Submitted request contains invalid fields.",
  "correlationId": "b6b8d2ef-2c13-4b88-90b5-1d9ec9b81e7f",
  "timestamp": "2026-11-10T12:00:00Z",
  "fieldErrors": [
    { "field": "amountWei", "message": "must be a positive integer string" }
  ]
}
```

Key codes: `REQUEST_VALIDATION_FAILED` (`400`), `VALIDATION_ERROR` (`400`), `MALFORMED_JSON` (`400`), `UNAUTHORIZED` (`401`), `FORBIDDEN` / `CSRF_VALIDATION_FAILED` (`403`), `NOT_FOUND` (`404`), `CONFLICT` / `DATA_CONFLICT` (`409`), `FILE_TOO_LARGE` (`413`), `RATE_LIMITED` (`429`), `EXTERNAL_SERVICE_ERROR` (`502` / `503`), `INTERNAL_ERROR` (`500`).
