# REST API Contracts & Security Semantics

Base path: `/api/v1` · Canonical OpenAPI 3 specification: [`docs/openapi.json`](./openapi.json) (continuously verified against SpringDoc `/v3/api-docs` in [`OpenApiContractVerificationTest`](../backend/src/test/java/com/safedeal/OpenApiContractVerificationTest.java)).

## 1. Authentication, Session Cookies & CSRF

- **Session Cookie (`safedeal_session`)**: `HttpOnly` HS256 JWT issued upon valid EIP-4361 SIWE signature verification (`POST /api/v1/auth/verify`). JavaScript cannot read this cookie.
- **Double-Submit CSRF (`safedeal_csrf` + `X-CSRF-Token`)**: Every authenticated mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) must supply the `safedeal_csrf` cookie value identically inside the `X-CSRF-Token` HTTP header.
- **Cross-Site TLS Deployments**: Set `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=None` when frontend (`Vercel`) and backend (`Railway`) operate on different domains over HTTPS.

## 2. Endpoint Reference

### System & Readiness

| Method & Path | Auth | Success Status | Response / Behavior |
|---|---|---|---|
| `GET /api/v1/health` | Public | `200 OK` | Liveness payload: `{ status: "UP", service, chainId, chainName, escrowContractConfigured }` |
| `GET /api/v1/health/ready` | Public | `200 OK` / `503 Service Unavailable` | Dependency readiness probe returning `ReadinessStatusResponse` (`status: "READY" \| "NOT_READY"`, `databaseConnected`, `evidenceStorageReady`, `siweConfigured`, `blockchainEnabled`, `escrowContractConfigured`, `chainId`). Returns HTTP `503` whenever DB connectivity (`SELECT 1`), evidence directory writability, SIWE settings, or enabled contract configuration fail. |
| `GET /actuator/health/readiness` | Public | `200 OK` | Spring Actuator readiness probe (`probes.enabled: true`) |

### Authentication (SIWE EIP-4361)

| Method & Path | Auth & Guard | Body | Response |
|---|---|---|---|
| `POST /api/v1/auth/nonce` | Public · IP Rate Limit (`429 RATE_LIMITED`) | `{ address, chainId }` | `{ nonce, domain, uri, chainId, issuedAt, expirationTime, statement, message }` |
| `POST /api/v1/auth/verify` | Public · IP Rate Limit | `{ message, signature }` | Sets `safedeal_session` (`HttpOnly`) & `safedeal_csrf`; returns `{ address, chainId, authenticatedAt, csrfToken }` |
| `GET /api/v1/auth/me` | Authenticated | — | `200` `{ address, chainId, authenticatedAt, csrfToken }` (or `401`) |
| `POST /api/v1/auth/logout` | Cookie clear | — | `204 No Content` |

### Deals

| Method & Path | Auth & Role | Request Body | Behavior & Response |
|---|---|---|---|
| `POST /api/v1/deals/drafts` | Auth + CSRF | `CreateDraftRequest` | Computes `tradeId` & RFC 8785 `termsHash`; returns `201` `CreateDraftResponse` (`DRAFT`) |
| `POST /api/v1/deals/{tradeId}/bind-tx` | Auth + CSRF · Seller only | `{ txHash }` | Inspects on-chain `TradeCreated` receipt + `getTrade`, verifies `termsHash`/`amountWei`/`arbiter`, binds deal (`CREATED`) |
| `POST /api/v1/deals/{tradeId}/sync` | Auth + CSRF · Viewer/Participant | `{ txHash? }` | Verifies optional tx receipt & fetches authoritative on-chain snapshot; advances forward status |
| `GET /api/v1/deals` | Auth | Query: `role`, `status`, `page`, `size` | Returns caller-scoped `PaginatedResponse<DealSummaryResponse>` |
| `GET /api/v1/deals/{tradeId}` | Auth · Participant/Arbiter or Open Buyer (`CREATED` & bound) | — | Returns `DealDetailResponse` |
| `GET /api/v1/deals/{tradeId}/history` | Auth · Viewer | — | Returns `{ events: DealEventResponse[], transactions: BlockchainTransactionResponse[] }` |

### Disputes & Evidence

| Method & Path | Auth & Role | Request Format | Behavior & Response |
|---|---|---|---|
| `POST /api/v1/deals/{tradeId}/disputes` | Auth + CSRF · Seller or Buyer | `{ reason, summary, txHash? }` | Verifies on-chain `DISPUTED` state, saves `Dispute` (`OPEN`) -> `201 Created` |
| `GET /api/v1/disputes/{disputeId}` | Auth · Seller, Buyer, or Arbiter | — | Returns `DisputeDetailResponse` (`403` for non-participants) |
| `GET /api/v1/disputes/{disputeId}/evidence` | Auth · Seller, Buyer, or Arbiter | — | Returns `DisputeEvidenceResponse[]` |
| `POST /api/v1/disputes/{disputeId}/evidence` | Auth + CSRF · Seller or Buyer (`OPEN` dispute) | `multipart/form-data` (`title`, `notes`, optional `file`) | Enforces MIME allowlist (`image/png`, `image/jpeg`, `application/pdf`, `text/plain`), magic-byte inspection, max size -> `201 Created` |
| `GET /api/v1/disputes/{disputeId}/evidence/{evidenceId}/download` | Auth · Seller, Buyer, or Arbiter | — | Binary attachment with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` |

### Arbitration

| Method & Path | Auth & Role | Request Body | Behavior & Response |
|---|---|---|---|
| `GET /api/v1/arbitration/disputes` | Auth | — | Returns all disputes assigned to caller as `arbiter` |
| `POST /api/v1/arbitration/disputes/{disputeId}/resolution` | Auth + CSRF · Assigned Arbiter | `{ txHash, rationale }` | Verifies on-chain `DisputeResolved` log, sum invariant `buyerAmount + sellerAmount == trade.amount`, and settled `RESOLVED` snapshot |

## 3. Standardized Error Envelope (`ApiErrorPayload`)

All `4xx` / `5xx` errors exclude internal stack traces and return consistent JSON:

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
