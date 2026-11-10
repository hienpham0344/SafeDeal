# AGENTS.md — SafeDeal Development Guidelines

Hướng dẫn cho AI agents khi làm việc với repository SafeDeal.

## 1. Tổng quan dự án & Stack thực tế

SafeDeal là nền tảng escrow P2P phi lưu ký trên Avalanche C-Chain (Fuji testnet & Anvil local).

- **Frontend (`frontend/`)**: React 18, Vite 6, TypeScript (strict), Tailwind CSS v3, React Router, TanStack Query v5, wagmi + viem, React Hook Form + Zod, Lucide React, Vitest, Playwright.
- **Backend (`backend/`)**: Java 21, Spring Boot 3.5.7, Gradle Wrapper (`./backend/gradlew`), PostgreSQL + Flyway (`ddl-auto: validate`), Spring Security (SIWE EIP-4361, HttpOnly session cookie + Double-Submit CSRF, Auth Rate Limit), Web3j, ArchUnit, H2 PostgreSQL-mode test profile + Testcontainers.
- **Blockchain (`blockchain/`)**: Solidity `0.8.28`, Foundry (`forge`, `anvil`, `cast`), OpenZeppelin Contracts, native AVAX pull-payment `SafeDealEscrow.sol`.
- **Infra (`infra/`)**: `docker-compose.yml` (`postgres`, `anvil`, `backend`, `frontend`), multi-stage Dockerfiles, Nginx SPA config (`frontend/nginx.conf`), Railway (`backend/railway.json`) & Vercel (`frontend/vercel.json`).
- **Scripts (`scripts/`)**: `install.sh`, `dev-db.sh`, `dev-anvil.sh`, `deploy-local.sh`, `deploy-fuji.sh`, `dev-backend.sh`, `dev-frontend.sh`, `verify.sh`, `smoke-test.sh`, `reset-dev.sh`.

## 2. Nguyên tắc vận hành (Agents-Kit Governance)

1. **Evidence Over Assertion**: Luôn chạy lệnh kiểm chứng thực tế trước khi kết luận hoàn thành:
   - Contracts: `forge test --root blockchain -vvv`
   - Backend: `./backend/gradlew -p backend test bootJar`
   - Frontend: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test && npm --prefix frontend run build`
   - Browser E2E: `npm --prefix frontend run test:e2e`
   - Full Gate: `bash scripts/verify.sh`
2. **Zero-Assumption & Read-First**: Đọc source/test/config thực tế trước khi sửa. Không đoán API signatures hay biến môi trường.
3. **Surgical Diffs**: Giữ diff tập trung; không đụng code/UI ngoài phạm vi.
4. **Immutable UI Rule (`/`)**: Tuyệt đối giữ nguyên layout, video URL, CSS classes, animations và responsive breakpoints của trang chủ Foldcraft (`frontend/src/pages/LandingPage.tsx`).
5. **Skill & Subagent Routing**: Tham chiếu `.agents/skills/` khi làm việc chuyên sâu (`avalanche-solidity-hardhat`, `wagmi-viem-web3-frontend`, `smart-contract-security-evm`, `security-and-hardening`, `playwright-e2e-automation`, `verification-before-completion`).

## 3. Ràng buộc kiến trúc & Bảo mật

### Blockchain (`blockchain/`)
- Mọi thanh toán đầu ra dùng **pull-payment** (`withdraw()`) với ReentrancyGuard và Checks-Effects-Interactions.
- State transitions chỉ chấp nhận qua các transition hợp lệ (`CREATED -> FUNDED -> DELIVERED -> RELEASED`, `CREATED -> CANCELLED`, `FUNDED -> REFUNDED`, `FUNDED|DELIVERED -> DISPUTED -> RESOLVED`).
- Buyer mở (`address(0)`) được chốt một lần khi `fundTrade()`, cấm seller/arbiter tự fund.

### Backend (`backend/`)
- Tuân thủ Clean Architecture (`domain/`, `application/`, `infrastructure/`, `presentation/`, `shared/`), được kiểm tra tự động bằng `ModuleBoundaryArchTest` (ArchUnit):
  - `domain/` không import Spring, JPA hay Web3j.
  - Không gọi RPC (`Web3jBlockchainGateway`) bên trong transaction database `@Transactional`; dùng `TransactionOperations` quanh khối DB ngắn.
- `termsHash` tạo bằng RFC 8785 (`CanonicalTermsHasher.java`) phải khớp tuyệt đối từng byte với `frontend/src/utils/canonical-terms.ts`.
- Mọi endpoint private yêu cầu phiên SIWE hợp lệ + Double-Submit CSRF header cho mutation endpoints; kiểm tra role participant/arbiter fail-closed.
- Không hardcode secrets, private key thật, contract addresses hay URL môi trường trong code/YAML; fail-fast nếu cấu hình production không an toàn.

### Frontend (`frontend/`)
- Không dùng `any`, không hardcode RPC/contract addresses/policy numbers (đặt trong `src/config/env.ts`, `network.config.ts`, `app.config.ts`, `brand.config.ts`).
- Không dùng `Number` float cho AVAX/wei (dùng `bigint` + `viem` `parseEther`/`formatEther`).
- Chặn gửi transaction on-chain nếu chưa kết nối đúng `chainId` hoặc contract chưa cấu hình.

## 4. Conventional Commits & Secrets Hygiene

- Commit format: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`, `ci(scope):`, `chore(scope):`.
- Không bao giờ commit `.env`, `DEPLOYER_PRIVATE_KEY`, `JWT_SECRET` thật hay mật khẩu database.
- Kiểm tra `git status` và `git diff` trước khi hoàn tất công việc.
