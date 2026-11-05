# AGENTS.md — SafeDeal Development Guidelines

Hướng dẫn cho AI agents (Codex, Cursor, Windsurf, v.v.) khi làm việc với repository SafeDeal.

---

## 🎯 Phạm vi dự án

SafeDeal là nền tảng escrow P2P hỗ trợ AI trên Avalanche (monorepo).

**Ngôn ngữ giao tiếp:** Tiếng Việt (code/docs bằng tiếng Anh).

**Stack:**
- Backend: Java 21, Spring Boot 4.1.2, PostgreSQL, Flyway
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, wagmi + viem
- Contracts: Solidity 0.8.28, Hardhat 3, OpenZeppelin 5.6, viem

**Môi trường:** Linux Mint (hoặc Ubuntu/Debian). Node.js 22+ (nvm), Java 21.

---

## 📐 Kiến trúc tổng quan

### Backend (Modular Monolith)

**Base package:** `com.safedeal`

**Business modules** (package-by-feature):
- `auth` — wallet challenge/response authentication
- `user` — user profiles và settings
- `deal` — transaction lifecycle
- `agreement` — agreement versions và participant approvals
- `negotiation` — conversation threads
- `escrow` — escrow state và blockchain tracking
- `warranty` — warranty deposits và claims
- `dispute` — dispute cases và arbitration
- `subscription` — Premium subscriptions và entitlements
- `ai` — AI orchestration, provider adapters, risk analysis
- `notification` — application notifications
- `blockchain` — Avalanche integration, event sync

**Shared foundation:**
- `common/` — error handling, security, validation, API responses, auditing

Mỗi module có các layer (chỉ tạo khi cần):
- `api/` — REST controllers, DTOs
- `application/` — use cases, application services
- `domain/` — domain models, business rules, repository interfaces
- `infrastructure/` — JPA entities, adapters, external integrations

**Nguyên tắc:**
- Modules giao tiếp qua **application services** hoặc domain ports.
- **KHÔNG truy cập trực tiếp** vào `domain/` hay `infrastructure/` của module khác.
- ArchUnit tests bảo vệ boundaries (`ModuleBoundaryTests`).

### Frontend (Feature-Based)

```
apps/web/src/
  app/              App Router pages
  features/         Feature modules (auth, deals, escrow, ...)
  components/ui/    Reusable UI primitives
  lib/              API client, utilities
  hooks/            React hooks
  config/           Environment, wagmi, navigation
  types/            TypeScript types
```

**Conventions:**
- Server Components mặc định; "use client" khi cần state/hooks.
- TanStack Query cho backend API calls.
- wagmi hooks cho wallet/blockchain state.
- Tailwind CSS utility-first (không dùng component library bên ngoài).

### Smart Contracts

**Contracts:**
- `EscrowManager` — holds funds, enforces state transitions, IntegrityGuard hook
- `SubscriptionManager` — on-chain Premium subscription
- `DisputeResolver` — dispute recording
- `MockPaymentToken` — test-only ERC-20 (Fuji)

**Safety:**
- AI **không bao giờ** tự ý chuyển tiền. Backend request → guard verify → on-chain action.
- `DeployerGuard` là bootstrap guard (allows release khi escrow FUNDED).

**Deployment:** Hardhat Ignition quản lý deployments. Copy addresses vào `.env` sau khi deploy.

---

## 🛠 Quy trình phát triển

### 1. Trước khi bắt đầu

**Kiểm tra môi trường:**
```bash
java -version      # Java 21 required
node -v            # Node.js 22+ required
npm -v
which psql         # PostgreSQL (Railway hoặc local)
```

**Clone và cài đặt:**
```bash
git clone https://github.com/hienpham0344/SafeDeal.git
cd SafeDeal
npm install        # installs all workspaces
```

**Setup environment:**
- Copy `.env.example` → `.env` (root), `apps/api/.env`, `apps/web/.env.local`, `packages/contracts/.env`
- Điền giá trị thực (database credentials, AI API key nếu có, Fuji deployer key cho contracts)

### 2. Khi implement module mới (Backend)

**Ví dụ: Implement `deal` module**

**a) Domain layer (business logic):**
```java
// apps/api/src/main/java/com/safedeal/deal/domain/Deal.java
package com.safedeal.deal.domain;

public record Deal(
    Long id,
    String dealId,
    String buyer,
    String seller,
    DealStatus status,
    Instant createdAt) {
    // Business rules here
}

// Repository interface
public interface DealRepository {
    Deal save(Deal deal);
    Optional<Deal> findByDealId(String dealId);
}
```

**b) Application layer (use cases):**
```java
// apps/api/src/main/java/com/safedeal/deal/application/CreateDealService.java
package com.safedeal.deal.application;

@Service
public class CreateDealService {
    private final DealRepository repository;
    // Use case logic
}
```

**c) Infrastructure layer (persistence):**
```java
// apps/api/src/main/java/com/safedeal/deal/infrastructure/JpaDealEntity.java
@Entity
@Table(name = "deals")
class JpaDealEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    // JPA mapping
}

// Adapter
@Repository
class JpaDealRepository implements DealRepository { ... }
```

**d) API layer (REST):**
```java
// apps/api/src/main/java/com/safedeal/deal/api/DealController.java
package com.safedeal.deal.api;

@RestController
@RequestMapping("/api/v1/deals")
public class DealController {
    // REST endpoints
}
```

**e) Database migration:**
```sql
-- apps/api/src/main/resources/db/migration/V2__create_deals_table.sql
CREATE TABLE deals (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deal_id       VARCHAR(64) NOT NULL UNIQUE,
    buyer         VARCHAR(42) NOT NULL,
    seller        VARCHAR(42) NOT NULL,
    status        VARCHAR(16) NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    updated_at    TIMESTAMP NOT NULL
);
```

**f) Tests:**
```java
// apps/api/src/test/java/com/safedeal/deal/application/CreateDealServiceTest.java
@SpringBootTest
@ActiveProfiles("test")
class CreateDealServiceTest {
    @Autowired private CreateDealService service;
    @Test void createsValidDeal() { ... }
}
```

**Chạy test:**
```bash
cd apps/api
./mvnw test
```

### 3. Khi implement feature mới (Frontend)

**Ví dụ: Implement deal creation form**

**a) Types:**
```typescript
// apps/web/src/types/deal.ts
export interface Deal {
  dealId: string;
  buyer: string;
  seller: string;
  status: "CREATED" | "FUNDED" | "RELEASED" | "REFUNDED" | "DISPUTED";
  createdAt: string;
}
```

**b) API client:**
```typescript
// apps/web/src/lib/deal-api.ts
import { apiRequest } from "./api-client";
import type { Deal } from "@/types/deal";

export async function createDeal(
  seller: string,
  amount: bigint,
  token: `0x${string}`,
  accessToken?: string,
): Promise<Deal> {
  return apiRequest<Deal>("/api/v1/deals", {
    method: "POST",
    body: { seller, amount: amount.toString(), token },
    accessToken,
  });
}
```

**c) Hook:**
```typescript
// apps/web/src/hooks/use-create-deal.ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDeal } from "@/lib/deal-api";

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ seller, amount, token }: { seller: string; amount: bigint; token: `0x${string}` }) =>
      createDeal(seller, amount, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}
```

**d) Component:**
```typescript
// apps/web/src/features/deals/CreateDealForm.tsx
"use client";

import { useState } from "react";
import { useCreateDeal } from "@/hooks/use-create-deal";
import { Button } from "@/components/ui/Button";

export function CreateDealForm() {
  const [seller, setSeller] = useState("");
  const createDeal = useCreateDeal();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await createDeal.mutateAsync({ seller, amount: 1000000n, token: "0x..." });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Seller address" />
      <Button type="submit" disabled={createDeal.isPending}>
        Create Deal
      </Button>
    </form>
  );
}
```

**e) Page:**
```typescript
// apps/web/src/app/deals/new/page.tsx
import { CreateDealForm } from "@/features/deals/CreateDealForm";

export default function NewDealPage() {
  return (
    <div>
      <h1>Create New Deal</h1>
      <CreateDealForm />
    </div>
  );
}
```

**f) Tests:**
```typescript
// apps/web/src/lib/deal-api.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Unit test cho pure logic (không cần browser)
```

**Chạy checks:**
```bash
cd apps/web
npm run typecheck
npm run lint
npm test
npm run build
```

### 4. Khi thêm smart contract function

**Ví dụ: Thêm warranty deposit vào EscrowManager**

**a) Update interface:**
```solidity
// packages/contracts/contracts/interfaces/IEscrowManager.sol
event WarrantyDeposited(bytes32 indexed dealId, uint256 amount, uint64 expiresAt);

function depositWarranty(bytes32 dealId, uint256 amount, uint64 periodSeconds) external;
```

**b) Implement:**
```solidity
// packages/contracts/contracts/escrow/EscrowManager.sol
function depositWarranty(bytes32 dealId, uint256 amount, uint64 periodSeconds) external nonReentrant {
    Escrow storage e = _escrows[dealId];
    require(e.status == EscrowStatus.FUNDED, "not funded");
    require(msg.sender == e.seller, "not seller");
    
    uint64 expiresAt = uint64(block.timestamp) + periodSeconds;
    IERC20(e.token).safeTransferFrom(msg.sender, address(this), amount);
    emit WarrantyDeposited(dealId, amount, expiresAt);
}
```

**c) Test:**
```typescript
// packages/contracts/test/EscrowManager.test.ts
it("lets the seller deposit a warranty", async () => {
  // setup
  const ctx = await setup();
  await fund(ctx);
  await ctx.token.write.mint([ctx.seller.account.address, ONE_USD]);
  await ctx.token.write.approve([ctx.escrow.address, ONE_USD], { account: ctx.seller.account });

  // act
  await ctx.escrow.write.depositWarranty([DEAL, ONE_USD, 30n * 24n * 3600n], { account: ctx.seller.account });

  // assert
  assert.equal(await ctx.token.read.balanceOf([ctx.escrow.address]), 2n * ONE_USD); // escrow + warranty
});
```

**d) Deploy và export ABI:**
```bash
npm run compile
npm run test
npm run abi:export
```

**e) Copy ABIs vào frontend:**
```bash
# Manual hoặc script
cp packages/contracts/abi/*.json apps/web/src/lib/abi/
```

**f) Update frontend contract calls:**
```typescript
// apps/web/src/lib/contracts.ts
import { getContract } from "viem";
import escrowAbi from "./abi/EscrowManager.json";
import { wagmiConfig } from "@/config/wagmi";

export function getEscrowContract(address: `0x${string}`) {
  return getContract({
    address,
    abi: escrowAbi,
    client: wagmiConfig.getClient(),
  });
}
```

### 5. Verification workflow

**Local verification (trước khi commit):**
```bash
bash scripts/verify.sh
```

Script này chạy:
- Backend: `./mvnw test`
- Contracts: `npm run compile && npm test`
- Web: `npm run typecheck && npm run lint && npm test && npm run build`

**Pre-commit hook (optional):**
```bash
# .git/hooks/pre-commit
#!/bin/bash
npm run lint:web || exit 1
cd apps/api && ./mvnw -q test || exit 1
```

---

## 🔒 Security & Secrets Management

### ❌ KHÔNG BAO GIỜ commit:
- Database passwords
- Private keys (DEPLOYER_PRIVATE_KEY)
- AI API keys (AI_API_KEY)
- JWT secrets
- Railway connection strings với credentials

### ✅ Cách quản lý secrets an toàn:

**Local development:**
- Dùng `.env` files (đã có trong `.gitignore`)
- Copy từ `.env.example`, điền giá trị thực

**CI/CD (GitHub Actions):**
- Dùng **GitHub Secrets** (Settings → Secrets and variables → Actions)
- Inject qua `env:` trong workflow YAML

**Production (Railway backend):**
- Dùng Railway environment variables UI
- Railway tự động inject `DATABASE_URL`
- Add custom vars: `AI_API_KEY`, `JWT_SECRET`, contract addresses

**Production (Vercel frontend):**
- Dùng Vercel environment variables UI
- Prefix public vars với `NEXT_PUBLIC_`
- `NEXT_PUBLIC_API_BASE_URL`, contract addresses

**Smart contracts deployment:**
```bash
# ĐÚNG: export trong shell session
export DEPLOYER_PRIVATE_KEY=0x...
npm run ignition:deploy:fuji

# SAI: hardcode trong hardhat.config.ts
const deployerKey = "0x1234..."; // ❌ NEVER DO THIS
```

---

## 🤖 Subagent Guidelines

Khi cần delegate công việc cho subagent (Codex multi-agent, Cursor composer, v.v.):

### 1. Backend module implementation

**Prompt template:**
```
Implement the `[MODULE_NAME]` module for SafeDeal backend.

Requirements:
- Follow the modular monolith pattern in AGENTS.md
- Domain layer: [describe entities, value objects, business rules]
- Application layer: [describe use cases]
- Infrastructure: JPA entities, repository adapter
- API: REST controller với endpoints [list endpoints]
- Database migration: V[N]__[description].sql
- Tests: unit tests cho application services, integration test cho controller

Context:
- Base package: com.safedeal.[MODULE_NAME]
- Spring Boot 4.1.2, Java 21
- PostgreSQL + Flyway
- Follow existing patterns in `auth/` or `blockchain/` modules

Constraints:
- DO NOT access other modules' domain/infrastructure packages
- Use public application services for cross-module calls
- Write tests before marking work complete
```

**Example:**
```
Implement the `deal` module for SafeDeal backend.

Requirements:
- Domain: Deal entity (dealId, buyer, seller, token, amount, status, timestamps)
- Use cases: CreateDeal, FundDeal, GetDealById, ListUserDeals
- REST endpoints: POST /api/v1/deals, GET /api/v1/deals/:id, GET /api/v1/deals
- Migration: V2__create_deals_table.sql
- Tests: CreateDealServiceTest, DealControllerTest

Context: See AGENTS.md backend section
```

### 2. Frontend feature implementation

**Prompt template:**
```
Implement the `[FEATURE_NAME]` feature for SafeDeal frontend.

Requirements:
- Types: [describe TypeScript interfaces]
- API client: functions in src/lib/[feature]-api.ts
- Hooks: [list React hooks needed]
- Components: [describe UI components]
- Pages: [describe routes]

Context:
- Next.js 16 App Router, React 19, TypeScript
- TanStack Query for API calls
- wagmi + viem for blockchain
- Tailwind CSS for styling
- Follow patterns in features/wallet/ or features/health/

Constraints:
- Use Server Components by default, "use client" only when needed
- No external component libraries (build with Tailwind)
- Write tests for pure logic (API client, utilities)
```

**Example:**
```
Implement deal listing and detail pages.

Requirements:
- Types: Deal interface (dealId, buyer, seller, status, createdAt)
- API: getDeal(id), listDeals(userId?)
- Hook: useDeal(id), useDeals(userId?)
- Components: DealCard, DealStatus badge
- Pages: /deals (list), /deals/[id] (detail)

Context: See AGENTS.md frontend section
```

### 3. Smart contract feature

**Prompt template:**
```
Add [FEATURE] to [CONTRACT_NAME] contract.

Requirements:
- Interface: update I[CONTRACT_NAME].sol with events and functions
- Implementation: update [CONTRACT_NAME].sol
- Tests: add test cases in test/[CONTRACT_NAME].test.ts
- Use viem assertions for error checking

Context:
- Solidity 0.8.28, OpenZeppelin 5.6
- Hardhat 3 with viem
- Follow patterns in existing contracts

Constraints:
- Never allow direct fund transfers without guard checks
- Emit events for every state change
- Write tests before marking complete
```

**Example:**
```
Add warranty deposit to EscrowManager.

Requirements:
- Event: WarrantyDeposited(dealId, amount, expiresAt)
- Function: depositWarranty(dealId, amount, periodSeconds) onlySeller
- Test: "lets the seller deposit a warranty"

Context: See packages/contracts/contracts/escrow/EscrowManager.sol
```

### 4. Database migration

**Prompt template:**
```
Create Flyway migration for [FEATURE].

Requirements:
- File: V[N]__[description].sql
- Tables: [list tables and columns]
- Constraints: [list FK, unique, checks]
- Indexes: [list needed indexes]

Context:
- PostgreSQL syntax
- Use BIGINT GENERATED ALWAYS AS IDENTITY for IDs
- Use TIMESTAMP for dates (UTC)
- Follow V1__baseline.sql pattern

Location: apps/api/src/main/resources/db/migration/
```

**Example:**
```
Create migration for deals table.

Tables:
- deals (id, deal_id UNIQUE, buyer, seller, token, amount, status, created_at, updated_at)

Constraints:
- status CHECK IN ('CREATED', 'FUNDED', 'RELEASED', 'REFUNDED', 'DISPUTED')

Indexes:
- idx_deals_buyer, idx_deals_seller

File: V2__create_deals_table.sql
```

### 5. CI/CD setup

**Prompt template:**
```
Setup CI/CD for SafeDeal [COMPONENT].

Requirements:
- GitHub Actions workflow: .github/workflows/[name].yml
- Jobs: [list jobs]
- Secrets needed: [list GitHub Secrets to configure]
- Deployment target: [Railway/Vercel/none]

Context:
- See existing .github/workflows/ci.yml
- Use actions/checkout@v7, actions/setup-node@v7, actions/setup-java@v6

Constraints:
- Never log secrets
- Use GitHub Secrets for all sensitive values
- Run tests before deploy
```

**Example:**
```
Setup Railway deployment for backend.

Requirements:
- Workflow: .github/workflows/deploy-backend.yml
- Trigger: push to main, workflow_dispatch
- Jobs: test → deploy-railway
- Secrets: RAILWAY_TOKEN, DATABASE_URL, AI_API_KEY, JWT_SECRET

Context: apps/api is Spring Boot 4.1.2 with Maven
```

---

## 📝 Code Review Checklist

Trước khi tạo PR hoặc commit:

### Backend
- [ ] Tuân thủ module boundaries (không truy cập trực tiếp domain/infrastructure của module khác)
- [ ] Business logic ở domain layer
- [ ] Use cases ở application layer
- [ ] JPA entities ở infrastructure layer
- [ ] Controllers ở api layer
- [ ] Flyway migration được tạo (nếu thay đổi schema)
- [ ] Tests pass (`./mvnw test`)
- [ ] Không hardcode credentials
- [ ] Exception handling đúng (GlobalExceptionHandler)
- [ ] Validation input (Jakarta Validation)

### Frontend
- [ ] TypeScript types đầy đủ (không dùng `any`)
- [ ] Server Components mặc định, "use client" chỉ khi cần
- [ ] API calls qua TanStack Query
- [ ] Blockchain calls qua wagmi hooks
- [ ] Tailwind CSS (không dùng inline styles)
- [ ] Tests cho pure logic
- [ ] Build pass (`npm run build`)
- [ ] Typecheck pass (`npm run typecheck`)
- [ ] Lint pass (`npm run lint`)
- [ ] Không commit `.env.local` với giá trị thực

### Contracts
- [ ] Events cho mọi state change
- [ ] Guards/modifiers bảo vệ critical functions
- [ ] Không cho phép AI tự ý chuyển tiền
- [ ] Tests pass (`npm test`)
- [ ] ABI được export (`npm run abi:export`)
- [ ] Không commit DEPLOYER_PRIVATE_KEY

### General
- [ ] Commit message rõ ràng
- [ ] Không commit secrets
- [ ] README được update (nếu thêm script/endpoint mới)
- [ ] `bash scripts/verify.sh` pass

---

## 🐛 Troubleshooting

### Backend không start

**Lỗi: `Failed to configure a DataSource`**
→ Check DB_HOST, DB_USERNAME, DB_PASSWORD trong `.env`

**Lỗi: `Flyway migration failed`**
→ Check migration syntax, hoặc xóa `flyway_schema_history` và chạy lại

**Lỗi: `Port 8080 already in use`**
```bash
lsof -i :8080  # tìm process
kill -9 <PID>
```

### Frontend không build

**Lỗi: `Module not found`**
→ Check `npm install` đã chạy chưa, check import paths

**Lỗi: TypeScript errors**
→ `npm run typecheck` để xem chi tiết

**Lỗi: ESLint errors**
→ `npm run lint` để xem chi tiết, có thể auto-fix với `npm run lint -- --fix`

### Contracts test fail

**Lỗi: `Cannot find module 'hardhat'`**
→ `npm install` ở root (installs workspace dependencies)

**Lỗi: `Compilation failed`**
→ Check Solidity syntax, version pragma

**Lỗi: Test timeout**
→ Tăng timeout trong test (`{ timeout: 60000 }`)

### Git issues

**Lỗi: Large files rejected**
→ Check `.gitignore`, remove `node_modules/`, `.next/`, `target/`, `artifacts/`, `cache/`

**Lỗi: Secrets detected**
→ Remove committed secrets:
```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all
```

---

## 📚 Tài liệu tham khảo

**Backend:**
- [Spring Boot 4.x Docs](https://docs.spring.io/spring-boot/docs/current/reference/html/)
- [Spring Security Reference](https://docs.spring.io/spring-security/reference/)
- [Flyway Migration Guide](https://flywaydb.org/documentation/)

**Frontend:**
- [Next.js 16 Docs](https://nextjs.org/docs)
- [React 19 Docs](https://react.dev/)
- [TanStack Query v5](https://tanstack.com/query/latest)
- [wagmi Docs](https://wagmi.sh/)
- [Tailwind CSS](https://tailwindcss.com/docs)

**Contracts:**
- [Hardhat Docs](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Solidity Docs](https://docs.soliditylang.org/)
- [viem Docs](https://viem.sh/)

**DevOps:**
- [Railway Docs](https://docs.railway.app/)
- [Vercel Docs](https://vercel.com/docs)
- [GitHub Actions](https://docs.github.com/en/actions)

---

## 🎓 Best Practices Summary

1. **Separation of Concerns:** Domain logic ≠ Infrastructure ≠ API
2. **Fail Closed:** Khi không chắc (auth, payment, guard), từ chối mặc định
3. **Test Before Complete:** Không claim "done" khi tests chưa pass
4. **Never Trust Client:** Backend verify mọi on-chain claims
5. **Secrets Stay Secret:** Dùng env vars, GitHub Secrets, Railway/Vercel UI
6. **Types Everywhere:** TypeScript strict mode, no `any`
7. **Progressive Enhancement:** Server Components first, client chỉ khi cần
8. **Explicit > Implicit:** Clear naming, obvious behavior
9. **Document Decisions:** Update AGENTS.md, README khi thay đổi quy ước
10. **Ask When Uncertain:** Better ask than guess wrong

---

**Cuối cùng:** Khi gặp vấn đề không rõ, hãy tham khảo code hiện tại trong các module đã implement (`auth/`, `blockchain/`, `ai/`) làm mẫu.
