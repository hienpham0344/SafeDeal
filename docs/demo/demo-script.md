# SafeDeal 3-Minute Demo Script (3 Flows + Hook)

## Pre-Demo Readiness Checklist
- **Live Production Stack (Recommended for Judges)**:
  - Web App: `https://avalanche-9b099.web.app/`
  - Backend Readiness: `https://safedeal-production.up.railway.app/api/v1/health/ready` (`READY`)
  - Network: Avalanche Fuji C-Chain (`chainId = 43113`)
  - Escrow Contract: [`0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`](https://testnet.snowtrace.io/address/0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29)
- **Automated Local 3-Tier Stack**: `bash scripts/e2e-live.sh` (Anvil + Rust `safedeal-api` + Vite preview + Playwright)
- **Interactive Local Stack**:
  - Terminal 1: PostgreSQL (`bash scripts/dev-db.sh`) & Anvil (`bash scripts/dev-anvil.sh`)
  - Terminal 2: Deployed `SafeDealEscrow` (`bash scripts/deploy-local.sh`) & Rust API (`bash scripts/dev-backend.sh`)
  - Terminal 3: React Vite frontend (`bash scripts/dev-frontend.sh`), browser ready with injected wallets for **Seller**, **Buyer**, **Arbiter**, and an **Outsider** account

---

## Storyboard & Voiceover Script

### [0:00 – 0:20] HOOK — The P2P Crypto Trust Paradox
- **Visual**: Open `https://avalanche-9b099.web.app/` (Foldcraft hero video + *"Trade with trust, not with blind faith"*). Overlay 3 quick captions: *"Pay first? Get scammed. Deliver first? Get ghosted. Centralized escrow? Custody risk."*
- **Voiceover**:
  > *"Every P2P crypto deal has a trust paradox: send AVAX upfront and risk getting scammed; deliver your work first and risk getting ghosted; use a centralized escrow and you're back to trusting a middleman. Meet SafeDeal — non-custodial P2P escrow on Avalanche, where smart contracts hold the funds, RFC 8785 locks the terms, and no admin can ever touch your AVAX."*

### [0:20 – 1:10] FLOW 1 — Cooperative Happy Path & Pull-Payment (`CREATED -> FUNDED -> DELIVERED -> RELEASED`)
- **Visual**:
  1. `/create`: Seller connects wallet, signs EIP-4361 SIWE (gasless), fills deal terms & amount, clicks **Preview** (show matching RFC 8785 `termsHash` between browser and Rust backend), and submits **Create Trade On-Chain** (`createTrade`).
  2. `/deals/:id`: Switch to Buyer -> **Fund Escrow** (`fundTrade`). Switch to Seller -> **Mark Delivered** (`markDelivered`). Switch to Buyer -> **Approve & Release Funds** (`releaseFunds`).
  3. `/dashboard`: Switch to Seller -> highlight Claimable Balance banner and click **Withdraw Balance** (`withdraw()`).
- **Voiceover**:
  > *"Flow 1 — Cooperative Trade. The seller drafts deal terms; SafeDeal hashes them deterministically with RFC 8785 in both TypeScript and Rust, then anchors `termsHash` on Avalanche Fuji. The buyer funds the vault, the seller marks delivery, and the buyer releases payment. Notice SafeDeal uses Pull-Payment (`withdraw()`) — funds credit claimable balances rather than pushing inline, eliminating reentrancy and reverting-contract DoS."*

### [1:10 – 1:45] FLOW 2 — Open-Buyer & Refund Protection (`CREATED -> FUNDED -> REFUNDED`)
- **Visual**:
  1. `/create`: Seller leaves **Buyer Address** blank to generate an Open-Buyer deal link; first Buyer to call `fundTrade` binds on-chain (`address(0)` -> Buyer).
  2. `/deals/:id`: Show **Refund Buyer** (`refundBySeller` for voluntary seller refund) or **Refund After Deadline** (`refundAfterDeadline` once delivery deadline passes without delivery).
  3. Buyer clicks **Withdraw AVAX** (`withdraw()`) to reclaim 100% of funds.
- **Voiceover**:
  > *"Flow 2 — Open-Buyer & Refund Protection. Need a public payment link? Leave the buyer blank—the first wallet to fund locks in as the buyer. And if a seller misses the delivery deadline—or issues a voluntary refund—the buyer reclaims 100% of their AVAX directly on-chain without asking anyone for permission."*

### [1:45 – 2:40] FLOW 3 — Dispute, Private Evidence & 2-of-3 Consensus + 14-Day Timeout (`DISPUTED -> RESOLVED`)
- **Visual**:
  1. `/deals/:id`: On a `FUNDED` or `DELIVERED` deal, Buyer clicks **Open Dispute** (`openDispute`).
  2. `/disputes/:id`: Buyer uploads a PNG screenshot (`multipart/form-data`); briefly switch to an **Outsider** wallet to show strict `403` / `Access Denied` enforcement.
  3. `/arbiter` & **DisputeConsensusPanel**: Arbiter + Buyer (or Seller) submit matching split votes (`submitResolutionVote`, e.g. 50/50 or 70/30). Highlight the **14-day timeout fallback** (`resolveDisputeByTimeout`). Both parties pull their settled shares via `withdraw()`.
- **Voiceover**:
  > *"Flow 3 — Dispute & 2-of-3 Consensus. When a deal goes wrong, participants upload private evidence validated by binary magic-bytes and gated by SIWE—outsiders get a strict 403. Unlike traditional escrows where a single arbiter has god-mode, SafeDeal requires 2-of-3 matching votes across Buyer, Seller, and Arbiter. And if everyone ghosts? After 14 days, anyone can trigger `resolveDisputeByTimeout` for a deterministic 50/50 split—zero trapped funds."*

### [2:40 – 3:00] OUTRO — Production Readiness & Verification
- **Visual**: Open `/support` showing `Avalanche Fuji C-Chain (43113)`, `Backend API: Operational`, Snowtrace contract link, and Fuji Testnet Faucet link.
- **Voiceover**:
  > *"Built with Solidity + Foundry invariant fuzzing, a Clean Architecture Rust backend on Railway, and a reload-safe React UI live on Avalanche Fuji. Try SafeDeal today at avalanche-9b099.web.app."*
