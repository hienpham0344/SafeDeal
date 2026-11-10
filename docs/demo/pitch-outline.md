# Pitch Outline (3-Minute Hackathon Deck)

1. **Hook — The P2P Crypto Trust Paradox**
   - Sending AVAX upfront creates delivery fraud risk; delivering software or goods upfront creates payment default risk; centralized escrow reintroduces custody risk and censorship.
2. **Meet SafeDeal — Non-Custodial Escrow on Avalanche**
   - Fast deterministic finality on Avalanche C-Chain paired with verifiable commercial agreements and private dispute workflows.
3. **Three Architectural Differentiators**
   - **Zero-Custody Pull-Payment Vault (`SafeDealEscrow.sol`)**: Immutable, no admin/sweep keys, CEI + `ReentrancyGuard`, griefing-proof `withdraw()`, strictly summed split arbitration (`buyer + seller == amount`), and stateful Foundry invariant proof.
   - **RFC 8785 Canonical Terms Anchoring**: Shared browser TypeScript + Java backend canonical JSON SHA-256 `termsHash` verified against on-chain `TradeCreated` events, plus reload-safe `/create` recovery preventing duplicate trade creation.
   - **Defense-in-Depth Coordination Backend**: SIWE EIP-4361 single-use nonces, `HttpOnly` JWT + Double-Submit CSRF, spoof-proof `remoteAddr` auth rate limiting, magic-byte validated evidence downloads, non-transactional Web3j RPC boundaries, ArchUnit-enforced Clean Architecture, and OpenAPI schema parity.
4. **Live Architecture & Verification**
   - Show clean architecture separation (`domain` / `application` / `infrastructure` / `presentation`) and real 3-tier E2E execution (`scripts/e2e-live.sh`) running unmocked Browser -> Vite -> packaged JAR -> Anvil.
5. **Explicit Trust Boundaries & Roadmap**
   - Acknowledge trusted human arbiter assumption when disputes escalate (`DISPUTED`); showcase roadmap for ERC-20 USDC support, S3/R2 encrypted object storage, and multi-sig/decentralized arbitration panels.
