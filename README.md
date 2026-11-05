# SafeDeal

AI-assisted escrow platform on Avalanche (monorepo scaffold).

**Status:** Architecture initialized. Business features not yet implemented.

## Repository Structure

```
apps/
  api/         Spring Boot backend (Java 21, PostgreSQL, Flyway)
  web/         Next.js frontend (React 19, Tailwind, wagmi + viem)
packages/
  contracts/   Solidity contracts (Hardhat 3, viem, OpenZeppelin)
docs/          Architecture decisions and integration guides
scripts/       Verification and setup automation
```

## Prerequisites

- **Java 21** — backend (install with SDKMAN or download Temurin binaries)
- **Node.js 22+** — frontend and contracts (managed via nvm)
- **PostgreSQL** — development database (Railway or local)

## Quick Start

**1. Install dependencies**

```bash
npm install
```

**2. Configure environment variables**

Backend (`apps/api/.env` or shell export):

```bash
# Database (Railway or local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=safedeal
DB_USERNAME=youruser
DB_PASSWORD=yourpass

# Optional: AI provider (defaults to mock)
AI_PROVIDER=mock
# AI_API_ENDPOINT=https://api.provider.com/v1
# AI_API_KEY=sk-...
# AI_MODEL=gpt-4

# Optional: Avalanche Fuji
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
ESCROW_MANAGER_ADDRESS=
SUBSCRIPTION_MANAGER_ADDRESS=
DISPUTE_RESOLVER_ADDRESS=
PAYMENT_TOKEN_ADDRESS=
```

Frontend (`apps/web/.env.local`):

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_ESCROW_MANAGER_ADDRESS=
NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS=
NEXT_PUBLIC_DISPUTE_RESOLVER_ADDRESS=
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=
```

Contracts (`packages/contracts/.env`):

```bash
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
DEPLOYER_PRIVATE_KEY=  # Testnet private key only
```

**3. Start the backend**

```bash
cd apps/api
./mvnw spring-boot:run
```

Health check: `curl http://localhost:8080/api/v1/health`

**4. Start the frontend**

```bash
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000).

**5. Deploy contracts (optional — Fuji testnet)**

```bash
cd packages/contracts
npm run ignition:deploy:fuji
```

After deployment, copy the output contract addresses into `.env` (backend) and `.env.local` (frontend).

## Development Commands

| Workspace | Command | Description |
|-----------|---------|-------------|
| Root | `npm run verify` | Runs backend tests, contract tests, web typecheck/lint/test/build |
| Backend | `cd apps/api && ./mvnw test` | Run Spring Boot unit/integration tests |
| Backend | `cd apps/api && ./mvnw spring-boot:run` | Start development server (port 8080) |
| Contracts | `npm run contracts:compile` | Compile Solidity with Hardhat |
| Contracts | `npm run contracts:test` | Run contract unit tests |
| Contracts | `npm run contracts:abi` | Export ABIs to `packages/contracts/abi/` |
| Web | `npm run dev:web` | Start Next.js dev server (port 3000) |
| Web | `npm run build:web` | Build Next.js production bundle |
| Web | `npm run lint:web` | Lint frontend with ESLint |
| Web | `npm run test:web` | Run web unit tests (tsx + node:test) |

## Architecture Decisions

### Backend (Modular Monolith)

**Base package:** `com.safedeal`

**Business modules:**

- `auth` — wallet challenge/response authentication
- `user` — user profiles and settings
- `deal` — transaction lifecycle
- `agreement` — agreement versions and approvals
- `negotiation` — conversation threads
- `escrow` — escrow state and blockchain tracking
- `warranty` — warranty deposits and claims
- `dispute` — dispute cases and arbitration
- `subscription` — Premium subscriptions and entitlements
- `ai` — AI orchestration, provider adapters, risk analysis
- `notification` — application notifications
- `blockchain` — Avalanche integration and event synchronization

**Shared foundation:**

- `common` — error handling, security baseline, validation, API error responses, auditing

Each module uses **package-by-feature** layering: `api/`, `application/`, `domain/`, `infrastructure/`. Modules interact through public application services or documented domain ports; direct access to another module's `domain` or `infrastructure` packages is not allowed (guarded by ArchUnit tests).

### Frontend (Feature-Based Organization)

- **Routing:** Next.js App Router (RSC + client components)
- **Styling:** Tailwind CSS (utility-first, no external component library yet)
- **Blockchain:** wagmi + viem for wallet connection and contract calls
- **Server state:** TanStack Query for backend REST API
- **Forms/validation:** Not scaffolded yet; added when the first editable form lands

Feature directories mirror backend modules (`features/deals`, `features/escrow`, ...). Reusable UI primitives live in `components/ui`.

### Smart Contracts

**Contracts:**

- `EscrowManager.sol` — holds buyer/seller funds and enforces state transitions
- `SubscriptionManager.sol` — on-chain Premium subscription tracking
- `DisputeResolver.sol` — records dispute cases and arbiter rulings
- `MockPaymentToken.sol` — test-only ERC-20 token (Fuji)

**Safety:**

- Every fund release passes through an optional **IntegrityGuard** hook (on-chain veto).
- The AI service can never unilaterally move funds; it requests backend actions that the guard verifies.
- `DeployerGuard` is a bootstrap implementation allowing releases only when an escrow is FUNDED.

**Deployment:**

Hardhat Ignition manages deployments. After deploying to Fuji, copy the output addresses into backend/frontend `.env` files.

### Database

Railway PostgreSQL (or local PostgreSQL) with Flyway migrations. The backend never connects directly to production during scaffold validation; it uses an in-memory H2 database for tests (`application-test.yml`).

**Baseline migration (`V1__baseline.sql`):** creates `chain_transactions` table (blockchain transaction verification). Business tables arrive in later migrations (`V2__...`, `V3__...`) when the corresponding module is implemented.

### AI Architecture

**Provider-agnostic:** domain services depend on `AiProvider` interface, not a vendor SDK. Adapter selection is controlled through `safedeal.ai.provider` (environment variable).

**Mock provider (default):** returns deterministic placeholder completions so the app runs without an external AI service.

**Real providers:** implement the same interface and are swapped via configuration.

**Safety:** the AI adapter exposes no way to transfer funds. It generates suggestions; the backend's subscription and escrow modules decide whether to execute them after checking entitlements and on-chain state.

## Security Considerations

**Wallet authentication:** Signing a server-issued challenge (nonce + timestamp) replaces wallet read-only connection with a stateless JWT. Replay protection and nonce expiration are part of the auth module design (not implemented yet).

**Authorization:** Role-based (Spring Security) and participant-based. The backend verifies that the authenticated wallet is a deal participant before exposing deal details.

**Blockchain verification:** The backend never trusts a frontend claim that payment succeeded. It verifies transaction receipts, checks expected event signatures, and marks transactions CONFIRMED only after the integrity guard approves.

**Secrets:** No credentials, private keys, or API keys are committed. All sensitive configuration comes from environment variables.

## Testing

**Backend:** JUnit 5 + Mockito. Tests boot the full Spring context against an in-memory H2 database (PostgreSQL mode). ArchUnit guards module boundaries.

**Contracts:** Hardhat node:test runner + viem assertions. Each test deploys fresh contract instances.

**Web:** `tsx --test` for unit tests (pure logic, no browser). End-to-end tests with Playwright are added later when workflows stabilize.

**Verification script:**

```bash
bash scripts/verify.sh
```

Runs backend tests, contract compilation/tests, and web typecheck/lint/test/build.

## Next Steps

1. **Authentication module** — implement wallet challenge signing and JWT issuance
2. **Deal module** — create, fund, and track buyer/seller transactions
3. **Escrow integration** — wire backend to `EscrowManager` contract events
4. **Negotiation module** — conversation threads and AI-assisted reply suggestions
5. **Agreement extraction** — AI-generated agreement drafts from negotiation transcripts
6. **Warranty module** — deposit tracking and claim windows
7. **Dispute module** — case creation, evidence submission, and arbitration workflow
8. **Subscription module** — Premium purchase and on-chain verification
9. **Real AI adapter** — HTTP client for OpenAI-compatible endpoints
10. **CI/CD** — GitHub Actions workflows for test + deploy (Railway backend, Vercel frontend)

## License

Proprietary — internal university project. Not licensed for public use.
