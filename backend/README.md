# SafeDeal Backend (Spring Boot 3.5.7 / Java 21)

Modular, non-custodial escrow coordination API, SIWE session authenticator, and resumable Avalanche event indexer.

## Architecture

- `domain/` — pure Java entities, state transition guards, RFC 8785 canonical terms hasher, and port interfaces (verified via ArchUnit).
- `application/` — transaction-bounded use cases (`siwe`, `deal`, `dispute`, `arbitration`, `synchronization`). External Web3j RPC calls never execute inside DB `@Transactional` locks.
- `infrastructure/` — JPA persistence + Flyway PostgreSQL schema (`V1__initial_schema.sql`), Web3j contract codec & gateway, JWT/HttpOnly cookie + Double-Submit CSRF security filters, auth rate limiter, local evidence storage adapter.
- `presentation/` — versioned REST controllers under `/api/v1/**`, DTO mapping, and global error handling.

## Verification & Execution

```bash
# Run unit, ArchUnit, and integration tests (H2 PostgreSQL compatibility mode)
./gradlew test

# Build executable JAR
./gradlew bootJar

# Run locally (requires PostgreSQL + RPC configured via backend/.env)
set -a && source .env && set +a
./gradlew bootRun
```
