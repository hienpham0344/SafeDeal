# SafeDeal Overview

## Problem

Peer-to-peer digital commerce, freelance deliverables, bespoke hardware trades, and OTC settlements suffer from an asymmetric trust gap:
- Paying upfront exposes the buyer to non-delivery or incomplete work.
- Delivering upfront exposes the seller to payment default.
- Centralized escrow intermediaries custody funds directly, introduce single-operator seizure/insolvency risk, charge steep fees, and run opaque dispute handling.

## Solution

**SafeDeal** is a non-custodial peer-to-peer escrow platform on **Avalanche C-Chain** (developed locally on Foundry Anvil `chainId=31337` and configured for Avalanche Fuji C-Chain `chainId=43113` and Mainnet readiness).

- **On-chain custody & deterministic state machine**: Native AVAX locks inside [`SafeDealEscrow.sol`](../blockchain/src/SafeDealEscrow.sol). No backend server, admin key, or deployer wallet can pause, sweep, or redirect locked funds outside strict contract state transitions.
- **Canonical off-chain terms anchored on-chain**: Commercial agreements (title, description, terms text, deadlines, inspection window, counterparty addresses, amountWei) are serialized deterministically using RFC 8785 Canonical JSON (`canonical-terms.ts` & `CanonicalTermsHasher.java`), hashed via SHA-256 (`termsHash`), and committed inside `createTrade(...)`.
- **Pull-payment settlement (`withdraw()`)**: Released, refunded, and arbitrated payouts credit internal `_claimableBalances` instead of pushing native AVAX during settlement, preventing push-griefing and reentrancy vectors.
- **Disputes & private evidence**: For `FUNDED` or `DELIVERED` deals, buyer or seller can open an on-chain dispute (`openDispute`) and upload supporting evidence (`PNG`, `JPEG`, `PDF`, `UTF-8 TXT`, verified via file magic signatures and capped by `EVIDENCE_MAX_BYTES`). Evidence visibility is restricted to the deal's `seller`, `buyer`, and assigned `arbiter`.

## Explicit Trust Model & Scope Boundaries

1. **Smart Contract Custody**: Only the buyer can release funds (`releaseFunds`) or reclaim overdue funds after `deliveryDeadline` (`refundAfterDeadline`). Only the seller can cancel an unfunded deal (`cancelUnfundedTrade`) or issue a voluntary refund while `FUNDED` (`refundBySeller`).
2. **Designated Human Arbiter Assumption**: Once escalated to `DISPUTED`, the immutable `arbiter` selected at trade creation holds exclusive authority to split escrowed funds (`buyerAmount + sellerAmount == trade.amount`) without receiving any payout themselves. SafeDeal does not adjudicate off-chain deliverable quality autonomously.
3. **Verifiable Web2.5 Coordination Layer**: PostgreSQL stores readable deal terms, timelines, transaction records, and ACL-restricted evidence metadata while reconciling all status transitions against on-chain truth via transaction receipt verification and `BlockchainEventIndexerService`.

## Repository Layout

- `frontend/` — React 18, Vite 6, TypeScript (strict), Tailwind CSS v3, wagmi + viem, TanStack Query v5, React Hook Form + Zod, Vitest, Playwright.
- `backend/` — Java 21, Spring Boot 3.5.7, Gradle, PostgreSQL 16 + Flyway (`ddl-auto: validate`), Spring Security (SIWE EIP-4361 + HttpOnly cookie + Double-Submit CSRF + IP rate limit), Web3j, ArchUnit, SpringDoc OpenAPI (`docs/openapi.json`).
- `blockchain/` — Solidity `0.8.28`, Foundry (`forge`, `anvil`, `cast`), OpenZeppelin Contracts (`ReentrancyGuard`).
- `infra/` — `docker-compose.yml`, multi-stage Dockerfiles, Nginx SPA headers, Railway & Vercel configs.
- `scripts/` — Monorepo setup (`install.sh`), local nodes (`dev-db.sh`, `dev-anvil.sh`), deployers (`deploy-local.sh`, `deploy-fuji.sh`), verification (`verify.sh`, `smoke-test.sh`, `e2e-live.sh`), and reset (`reset-dev.sh`).

## Documentation Index

| Document | Topic |
|---|---|
| [`01-requirements.md`](./01-requirements.md) | Problem framing, UNIHACK 2026 alignment (16 decisions, 5 Sprint 0 deliverables), functional & NFR scope |
| [`02-architecture.md`](./02-architecture.md) | Clean Architecture, module boundaries, non-transactional RPC design & indexing diagrams |
| [`03-database-design.md`](./03-database-design.md) | PostgreSQL Flyway schema (`V1__initial_schema.sql`), unique constraints, indexer deduplication |
| [`04-api-contracts.md`](./04-api-contracts.md) | REST endpoints, readiness probe, SIWE auth, CSRF headers, error envelope, `docs/openapi.json` |
| [`05-business-flows.md`](./05-business-flows.md) | Trade lifecycle sequences, RFC 8785 matching, reload-safe `/create` recovery, disputes |
| [`06-state-machines.md`](./06-state-machines.md) | On-chain/off-chain `DealStatus` and `DisputeStatus` state machine & reconciliation rules |
| [`07-smart-contract-design.md`](./07-smart-contract-design.md) | `SafeDealEscrow.sol` pull-payment storage, CEI, role guards & Foundry fuzz invariants |
| [`08-security.md`](./08-security.md) | Threat model, SIWE single-use nonces, HttpOnly + CSRF, magic-byte upload defense, prod checks |
| [`09-deployment.md`](./09-deployment.md) | Docker Compose stack, Railway + Vercel production topology, GitHub Actions CI/CD |
| [`10-testing-strategy.md`](./10-testing-strategy.md) | Foundry, ArchUnit/MockMvc/OpenAPI sync, Vitest, Playwright responsive/fault tests & 3-tier E2E |
| [`11-configuration-guide.md`](./11-configuration-guide.md) | Environment variable matrix (`blockchain/`, `backend/`, `frontend/`, config modules) |
| [`12-local-development.md`](./12-local-development.md) | Step-by-step local Anvil + Postgres walkthrough (Setup Steps 1–8) |
| [`13-fuji-setup.md`](./13-fuji-setup.md) | Step-by-step Avalanche Fuji C-Chain testnet deployment (Setup Steps 9–13) |
| [`14-railway-setup.md`](./14-railway-setup.md) | Step-by-step Railway + PostgreSQL + Vercel production setup (Setup Steps 14–19) |
| [`15-troubleshooting.md`](./15-troubleshooting.md) | Common failure diagnostics (SIWE, CSRF, `/health/ready`, rate limits, magic bytes, reloads) |
| [`16-hackathon-submission.md`](./16-hackathon-submission.md) | UNIHACK 2026 submission dossier, verification ledger & deployment placeholders |
| [`demo/demo-script.md`](./demo/demo-script.md) | 5-minute live judge walkthrough |
| [`demo/pitch-outline.md`](./demo/pitch-outline.md) | 3-minute hackathon pitch deck outline |
| [`demo/judge-qa.md`](./demo/judge-qa.md) | Technical Q&A for security & architecture evaluation |
