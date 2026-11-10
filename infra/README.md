# Infrastructure & Deployment Overview

This directory contains container orchestration and cloud deployment descriptors for SafeDeal:

- `docker-compose.yml` — local full-stack orchestration (`postgres`, `anvil`, `backend`, `frontend`).
- `railway/README.md` — Spring Boot + PostgreSQL deployment guide on Railway (`backend/railway.json`).
- `vercel/README.md` — React + Vite SPA deployment guide on Vercel (`frontend/vercel.json`).

## Local Docker Compose Usage

Run from repository root:
```bash
cp .env.example .env
# Populate JWT_SECRET (>= 32 random chars, e.g. `openssl rand -hex 32`) inside .env
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

Services:
- Frontend UI: `http://localhost:5173`
- Backend API: `http://localhost:8080` (`/api/v1/health`)
- Anvil JSON-RPC: `http://localhost:8545`
- PostgreSQL: `localhost:5432` (`safedeal`)
