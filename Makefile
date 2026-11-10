.PHONY: help install verify dev-db dev-anvil deploy-local deploy-fuji dev-backend dev-frontend test-contracts test-backend test-frontend e2e-frontend smoke-test reset-dev

help:
	@echo "SafeDeal Monorepo Targets:"
	@echo "  make install         - Check toolchains and install frontend/Foundry dependencies"
	@echo "  make verify          - Run blockchain, backend, frontend checks, and Playwright E2E"
	@echo "  make dev-db          - Start local PostgreSQL container via Docker Compose"
	@echo "  make dev-anvil       - Start local Anvil node (chainId 31337)"
	@echo "  make deploy-local    - Deploy SafeDealEscrow to local Anvil"
	@echo "  make deploy-fuji     - Deploy SafeDealEscrow to Avalanche Fuji testnet"
	@echo "  make dev-backend     - Start Spring Boot backend"
	@echo "  make dev-frontend    - Start Vite React development server"
	@echo "  make test-contracts  - Run Foundry contract tests"
	@echo "  make test-backend    - Run Gradle tests & build Spring Boot JAR"
	@echo "  make test-frontend   - Run frontend typecheck, lint, Vitest tests, and Vite build"
	@echo "  make e2e-frontend    - Run Playwright browser suite against built frontend"
	@echo "  make smoke-test      - Probe running backend health and frontend availability"
	@echo "  make reset-dev       - Reset local Docker volumes, evidence uploads, and local deploy metadata"

install:
	bash scripts/install.sh

verify:
	bash scripts/verify.sh

dev-db:
	bash scripts/dev-db.sh

dev-anvil:
	bash scripts/dev-anvil.sh

deploy-local:
	bash scripts/deploy-local.sh

deploy-fuji:
	bash scripts/deploy-fuji.sh

dev-backend:
	bash scripts/dev-backend.sh

dev-frontend:
	bash scripts/dev-frontend.sh

test-contracts:
	forge test --root blockchain -vvv

test-backend:
	./backend/gradlew -p backend test bootJar

test-frontend:
	npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test && npm --prefix frontend run build

e2e-frontend:
	npm --prefix frontend run test:e2e

smoke-test:
	bash scripts/smoke-test.sh

reset-dev:
	bash scripts/reset-dev.sh
