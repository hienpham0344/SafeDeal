# Pitch Outline (3-Minute Hackathon Deck)

1. **Hook — The P2P Crypto Trust Paradox**
   - Sending AVAX upfront creates delivery fraud risk; delivering software or goods upfront creates payment default risk; centralized escrow reintroduces custody risk and censorship.
2. **Meet SafeDeal — Non-Custodial Escrow on Avalanche**
   - Fast deterministic finality on Avalanche C-Chain paired with verifiable commercial agreements and private dispute workflows.
3. **Three Architectural Differentiators**
   - **Zero-Custody Pull-Payment Vault (`SafeDealEscrow.sol`)**: Immutable, no admin/sweep keys, CEI + `ReentrancyGuard`, griefing-proof `withdraw()`, **2-of-3 multi-party dispute consensus + 14-day 50/50 stalemate timeout**, and stateful Foundry invariant proof.
   - **RFC 8785 Canonical Terms Anchoring**: Shared browser TypeScript + Rust backend (`canonical_terms.rs`) canonical JSON SHA-256 `termsHash` verified against on-chain `TradeCreated` events, plus reload-safe `/create` recovery preventing duplicate trade creation.
   - **Defense-in-Depth Coordination Backend (Rust)**: SIWE EIP-4361 single-use nonces (`k256` + `sha3`), `HttpOnly` JWT + Double-Submit CSRF, peer-IP auth rate limiting, magic-byte validated evidence downloads (`local` & S3/R2), non-transactional `AlloyBlockchainGateway` RPC boundaries, `architecture_dag.rs` Clean Architecture enforcement, and OpenAPI schema parity.
4. **Live Deployment & Verification**
   - Live on **Avalanche Fuji** (`0xF30E863b0Cfe8fBFE05E65c21878F8B621B3FE29`), **Railway** (`safedeal-production.up.railway.app`), and **Firebase Hosting** (`avalanche-9b099.web.app`), backed by unmocked 3-tier E2E (`scripts/e2e-live.sh`) running Browser -> Vite -> `safedeal-api` -> Anvil.
5. **Explicit Trust Boundaries & Roadmap**
   - Acknowledge trusted arbiter role in 2-of-3 dispute consensus (`DISPUTED`); showcase roadmap for ERC-20 USDC support on Avalanche, Redis-backed distributed rate limiting, and multi-sig/decentralized arbitration panels.
