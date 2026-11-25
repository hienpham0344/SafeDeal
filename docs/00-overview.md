# SafeDeal Overview

## Problem

Peer-to-peer digital commerce, student/freelance deliverables, bespoke hardware trades, and OTC settlements suffer from an asymmetric trust gap:
- Paying upfront exposes the buyer to non-delivery or incomplete work.
- Delivering upfront exposes the seller to payment default or buyer ghosting.
- Centralized escrow intermediaries custody funds directly, introduce single-operator seizure/insolvency risk, charge steep fees, and run opaque dispute handling.

## Solution

**SafeDeal** is a non-custodial peer-to-peer escrow platform and browser companion on **Avalanche C-Chain** (developed locally on Foundry Anvil `chainId=31337` and deployed live on Avalanche Fuji C-Chain `chainId=43113` with Mainnet readiness), competing in **SEApp UIT (Bảng App — Khoa Công nghệ Phần mềm, Trường ĐH Công nghệ Thông tin, ĐHQG-HCM)**.

- **On-chain custody & deterministic state machine**: Native AVAX locks inside [`SafeDealEscrow.sol`](../blockchain/src/SafeDealEscrow.sol). No backend server, admin key, or deployer wallet can pause, sweep, or redirect locked funds outside strict contract state transitions.
- **Canonical off-chain terms anchored on-chain**: Commercial agreements (title, description, terms text, deadlines, inspection window, counterparty addresses, amountWei) are serialized deterministically using RFC 8785 Canonical JSON (`canonical-terms.ts`, `canonical_terms.rs`, and `extension/shared/canonical-terms.js`), hashed via SHA-256 (`termsHash`), and committed inside `createTrade(...)`.
- **Pull-payment settlement (`withdraw()`)**: Released, refunded, and arbitrated payouts credit internal `_claimableBalances` instead of pushing native AVAX during settlement, preventing push-griefing and reentrancy vectors.
- **2-of-3 Multi-Party Dispute Consensus + 14-Day Stalemate Fallback**: For `FUNDED` or `DELIVERED` deals, buyer or seller can open an on-chain dispute (`openDispute`) and upload supporting evidence (`PNG`, `JPEG`, `PDF`, `UTF-8 TXT`, verified via file magic signatures and SHA-256 digests). Disputes settle without unilateral arbiter "god-mode" as soon as **any 2 of 3 participants (`buyer`, `seller`, `arbiter`)** submit matching split votes via `submitResolutionVote(tradeId, buyerAmount, sellerAmount)`, or via a deterministic **50/50 split after 14 days** (`resolveDisputeByTimeout(tradeId)`).
- **SafeDeal Escrow Companion (`extension/`, Manifest V3 Chrome Extension)**: Brings non-custodial verification directly into social and marketplace workflows (Facebook Groups, Discord, Telegram, Chợ Tốt, GitHub) via a Chrome Side Panel on-chain deal verifier (`eth_call` `getTrade`), local RFC 8785 `termsHash` checker, Shadow DOM status badges, and right-click context-menu draft capture.

## Explicit Trust Model & Scope Boundaries

1. **Smart Contract Custody**: Only the buyer can release funds (`releaseFunds`) or reclaim overdue funds after `deliveryDeadline` (`refundAfterDeadline`). Only the seller can cancel an unfunded deal (`cancelUnfundedTrade`) or issue a voluntary refund while `FUNDED` (`refundBySeller`).
2. **2-of-3 Consensus Arbitration & 14-Day Liveness Guarantee**: Once escalated to `DISPUTED`, no single actor can unilaterally confiscate funds. Settlement requires 2-of-3 matching split proposals (`buyerAmount + sellerAmount == trade.amount`, `0` fee to `arbiter`) via `submitResolutionVote`. If 2-of-3 consensus is not reached within `DISPUTE_TIMEOUT` (14 days), any party can call `resolveDisputeByTimeout` for an automatic 50/50 split so funds are never permanently locked.
3. **Verifiable Web2.5 Coordination Layer**: PostgreSQL stores readable deal terms, timelines, transaction records, consensus votes, and ACL-restricted evidence metadata while reconciling all status transitions against on-chain truth via transaction receipt verification and `BlockchainEventIndexerService`.

## Repository Layout

- `frontend/` — React 18, Vite 6, TypeScript (strict), Tailwind CSS v3, wagmi + viem, TanStack Query v5, React Hook Form + Zod, Vitest, Playwright (with 1-click SEApp UIT Student Deal Templates & Fuji Faucet gas check).
- `backend/` — Rust 1.91+, Cargo workspace (`crates/{shared,domain,application,infrastructure,presentation}`), Axum 0.8 + Tokio, PostgreSQL 16 + SQLx migrations (`backend/migrations/`, 12 tables), SIWE EIP-4361 (`k256` + `sha3`) + dual-mode HS256 JWT (`HttpOnly` cookie + Double-Submit CSRF + cross-origin `Authorization: Bearer` fallback) + peer-IP auth rate limit, Alloy JSON-RPC gateway, crate-DAG architecture test, `utoipa` OpenAPI (`docs/openapi.json`).
- `blockchain/` — Solidity `0.8.28`, Foundry (`forge`, `anvil`, `cast`), OpenZeppelin Contracts (`ReentrancyGuard`), 2-of-3 dispute consensus & 14-day timeout fallback.
- `extension/` — Manifest V3 Chrome Extension (`SafeDeal Escrow Companion — Avalanche P2P Verifier`): Side Panel verifier (`sidepanel/`), RFC 8785 canonical terms hasher (`shared/canonical-terms.js`), read-only Fuji/Anvil RPC client (`shared/rpc-client.js`), non-blocking content script (`content/deal-verifier.js`), and Chrome Web Store dossier (`CHROMEWEBSTORE.md`).
- `infra/` — `docker-compose.yml`, multi-stage Dockerfiles, Nginx SPA headers, Railway & Firebase Hosting configs.
- `scripts/` — Monorepo setup (`install.sh`), local nodes (`dev-db.sh`, `dev-anvil.sh`), deployers (`deploy-local.sh`, `deploy-fuji.sh`), verification (`verify.sh`, `smoke-test.sh`, `e2e-live.sh`), and reset (`reset-dev.sh`).

## Documentation Index

| Document | Topic |
|---|---|
| [`01-requirements.md`](./01-requirements.md) | Problem framing, SEApp UIT (Bảng App) alignment, 16 architectural decisions, functional & NFR scope |
| [`02-architecture.md`](./02-architecture.md) | Clean Architecture 5-crate Rust workspace, MV3 Chrome Extension, non-transactional RPC & indexing diagrams |
| [`03-database-design.md`](./03-database-design.md) | PostgreSQL 16 SQLx migrations (`backend/migrations/*.sql`), 12-table inventory (including `dispute_votes`), deduplication |
| [`04-api-contracts.md`](./04-api-contracts.md) | REST endpoints, readiness probe, dual-mode SIWE auth + CSRF/Bearer, dispute voting/timeout routes, `docs/openapi.json` |
| [`05-business-flows.md`](./05-business-flows.md) | Trade lifecycle sequences, RFC 8785 matching, reload-safe `/create` recovery, 2-of-3 dispute consensus & timeout |
| [`06-state-machines.md`](./06-state-machines.md) | On-chain/off-chain `DealStatus` and `DisputeStatus` state machine & reconciliation rules |
| [`07-smart-contract-design.md`](./07-smart-contract-design.md) | `SafeDealEscrow.sol` pull-payment storage, CEI, 2-of-3 `submitResolutionVote`, 14-day `resolveDisputeByTimeout` & Foundry invariants |
| [`08-security.md`](./08-security.md) | Threat model, SIWE single-use nonces, dual-mode HttpOnly/CSRF + Bearer auth, magic-byte & SHA-256 evidence defense |
| [`09-deployment.md`](./09-deployment.md) | Docker Compose stack, Rust `debian:bookworm-slim` runtime, Railway + Firebase Hosting production topology, CI/CD |
| [`10-testing-strategy.md`](./10-testing-strategy.md) | Foundry, Cargo crate-DAG/integration/OpenAPI sync, Vitest, Playwright responsive/fault tests & 3-tier E2E |
| [`11-configuration-guide.md`](./11-configuration-guide.md) | Environment variable matrix (`blockchain/`, `backend/`, `frontend/`, config modules) |
| [`12-local-development.md`](./12-local-development.md) | Step-by-step local Anvil + Postgres walkthrough (Setup Steps 1–8) |
| [`13-fuji-setup.md`](./13-fuji-setup.md) | Step-by-step Avalanche Fuji C-Chain testnet deployment (Setup Steps 9–13) |
| [`14-railway-setup.md`](./14-railway-setup.md) | Step-by-step Railway + PostgreSQL + Firebase Hosting production setup (Setup Steps 14–19) |
| [`15-troubleshooting.md`](./15-troubleshooting.md) | Common failure diagnostics (SIWE, CSRF, `/health/ready`, `AppConfig::validate`, rate limits, magic bytes) |
| [`16-hackathon-submission.md`](./16-hackathon-submission.md) | SEApp UIT (Bảng App) technical submission summary, verification ledger & live deployment endpoints |
| [`17-seapp-uit-submission.md`](./17-seapp-uit-submission.md) | Complete Vietnamese SEApp UIT submission package (Google Form copy, A1/Standee Tầng 7 Tòa E Poster, 3-minute Booth Pitch) |
| [`demo/demo-script.md`](./demo/demo-script.md) | 3-minute live judge walkthrough |
| [`demo/pitch-outline.md`](./demo/pitch-outline.md) | 3-minute pitch deck outline |
| [`demo/judge-qa.md`](./demo/judge-qa.md) | Technical Q&A for security, game-theory arbitration & Chrome Extension evaluation |
