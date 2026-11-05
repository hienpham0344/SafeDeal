# CI/CD Setup Guide — SafeDeal

Hướng dẫn thiết lập CI/CD cho SafeDeal với GitHub Actions, Railway (backend) và Vercel (frontend).

---

## 🔐 Security Principles

**KHÔNG BAO GIỜ:**
- Commit secrets vào repository
- Log secrets trong GitHub Actions logs
- Hardcode credentials trong code hoặc config files
- Share secrets qua chat/email

**LUÔN LUÔN:**
- Dùng GitHub Secrets cho CI/CD
- Dùng Railway/Vercel environment variables UI cho production
- Dùng `.env` files cho local development (trong `.gitignore`)
- Review GitHub Actions logs trước khi merge PR

---

## 📋 Prerequisites

1. **GitHub repository:** `hienpham0344/SafeDeal`
2. **Railway account:** [railway.app](https://railway.app) (free tier OK)
3. **Vercel account:** [vercel.com](https://vercel.com) (hobby tier OK)
4. **Avalanche Fuji testnet wallet** với AVAX test tokens

---

## 🔧 Setup GitHub Secrets

Vào repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### Backend Secrets (Railway)

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `RAILWAY_TOKEN` | `[from Railway]` | Railway API token (Project Settings → Tokens) |
| `DATABASE_URL` | `postgresql://user:pass@host:port/db` | Railway PostgreSQL connection URL |
| `JWT_SECRET` | `[random 64 chars]` | JWT signing secret (generate: `openssl rand -hex 32`) |
| `AI_API_KEY` | `sk-...` | AI provider API key (nếu dùng real AI provider) |
| `CORS_ALLOWED_ORIGINS` | `https://safedeal.vercel.app` | Frontend production URL |

### Frontend Secrets (Vercel)

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `VERCEL_TOKEN` | `[from Vercel]` | Vercel API token (Settings → Tokens) |
| `VERCEL_ORG_ID` | `[from Vercel]` | Vercel organization ID (`.vercel/project.json` sau khi link project) |
| `VERCEL_PROJECT_ID` | `[from Vercel]` | Vercel project ID (`.vercel/project.json`) |

### Contracts Secrets (Fuji Deployment)

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `DEPLOYER_PRIVATE_KEY` | `0x...` | **Testnet only** private key with Fuji AVAX |

**⚠️ QUAN TRỌNG:** Deployer key chỉ dùng cho testnet. Không bao giờ commit private key có real funds.

---

## 🚀 Railway Backend Setup

### 1. Create Railway Project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project (run in apps/api/)
cd apps/api
railway link
```

Hoặc qua UI:
1. Vào [railway.app/new](https://railway.app/new)
2. Chọn "Deploy from GitHub repo"
3. Chọn `hienpham0344/SafeDeal`
4. Root directory: `apps/api`
5. Build command: `./mvnw package -DskipTests`
6. Start command: `java -jar target/safedeal-api-0.1.0-SNAPSHOT.jar`

### 2. Add PostgreSQL Database

1. Railway project → **New** → **Database** → **PostgreSQL**
2. Railway tự động tạo `DATABASE_URL` environment variable
3. Copy `DATABASE_URL` value vào GitHub Secret (cho CI nếu cần)

### 3. Configure Environment Variables

Railway project → **Variables** tab:

```env
# Railway tự động inject DATABASE_URL
SPRING_PROFILES_ACTIVE=prod
PORT=8080

# Add these manually:
JWT_SECRET=[copy from GitHub Secret]
AI_PROVIDER=mock
AI_API_ENDPOINT=
AI_API_KEY=[nếu dùng real provider]
AI_MODEL=

CORS_ALLOWED_ORIGINS=https://safedeal.vercel.app

# Contract addresses (sau khi deploy contracts)
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
AVALANCHE_CHAIN_ID=43113
BLOCKCHAIN_CONFIRMATIONS=2
ESCROW_MANAGER_ADDRESS=0x...
SUBSCRIPTION_MANAGER_ADDRESS=0x...
DISPUTE_RESOLVER_ADDRESS=0x...
PAYMENT_TOKEN_ADDRESS=0x...
```

### 4. Get Railway API Token

1. Railway project → **Settings** → **Tokens**
2. Create token với scope `Deploy only`
3. Copy token vào GitHub Secret `RAILWAY_TOKEN`

### 5. Deploy

**Manual deploy (test first):**
```bash
cd apps/api
railway up
```

**Auto deploy:** Push lên `main` branch → GitHub Actions tự động deploy

**Check deployment:**
```bash
curl https://safedeal-production.up.railway.app/api/v1/health
```

---

## ☁️ Vercel Frontend Setup

### 1. Install Vercel CLI

```bash
npm install -g vercel

# Login
vercel login

# Link project (run in apps/web/)
cd apps/web
vercel link
```

### 2. Create Vercel Project (UI)

1. Vào [vercel.com/new](https://vercel.com/new)
2. Import `hienpham0344/SafeDeal`
3. **Framework Preset:** Next.js
4. **Root Directory:** `apps/web`
5. **Build Command:** `npm run build` (default OK)
6. **Output Directory:** `.next` (default OK)

### 3. Configure Environment Variables

Vercel project → **Settings** → **Environment Variables**:

**Production:**
```env
NEXT_PUBLIC_API_BASE_URL=https://safedeal-production.up.railway.app
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# Contract addresses (sau khi deploy contracts):
NEXT_PUBLIC_ESCROW_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_DISPUTE_RESOLVER_ADDRESS=0x...
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x...
```

**Preview (optional):**
- Same as production, nhưng `NEXT_PUBLIC_API_BASE_URL` trỏ về Railway staging environment (nếu có)

### 4. Get Vercel Tokens

**a) Vercel Token:**
1. Vercel → **Settings** → **Tokens**
2. Create token
3. Copy vào GitHub Secret `VERCEL_TOKEN`

**b) Org ID & Project ID:**
```bash
cd apps/web
vercel link  # tạo .vercel/project.json
cat .vercel/project.json
```

Copy `orgId` → GitHub Secret `VERCEL_ORG_ID`  
Copy `projectId` → GitHub Secret `VERCEL_PROJECT_ID`

### 5. Deploy

**Manual deploy (test first):**
```bash
cd apps/web
vercel --prod
```

**Auto deploy:** Push lên `main` → Vercel tự động deploy

**Check deployment:**
```
https://safedeal.vercel.app/api/health
```

---

## 📦 Smart Contracts Deployment

### 1. Get Fuji AVAX

1. Vào [core.app/tools/testnet-faucet](https://core.app/tools/testnet-faucet)
2. Nhập wallet address
3. Request AVAX testnet tokens

### 2. Deploy Contracts

**Local:**
```bash
cd packages/contracts
export DEPLOYER_PRIVATE_KEY=0x...
npm run ignition:deploy:fuji
```

Output:
```
SafeDealModule#EscrowManager - 0xABC...
SafeDealModule#SubscriptionManager - 0xDEF...
SafeDealModule#DisputeResolver - 0x123...
SafeDealModule#MockPaymentToken - 0x456...
```

### 3. Update Environment Variables

Copy addresses vào:

**Backend (Railway):**
```env
ESCROW_MANAGER_ADDRESS=0xABC...
SUBSCRIPTION_MANAGER_ADDRESS=0xDEF...
DISPUTE_RESOLVER_ADDRESS=0x123...
PAYMENT_TOKEN_ADDRESS=0x456...
```

**Frontend (Vercel):**
```env
NEXT_PUBLIC_ESCROW_MANAGER_ADDRESS=0xABC...
NEXT_PUBLIC_SUBSCRIPTION_MANAGER_ADDRESS=0xDEF...
NEXT_PUBLIC_DISPUTE_RESOLVER_ADDRESS=0x123...
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x456...
```

**⚠️ Deploy lại sau khi update:**
- Backend: `railway up` hoặc trigger GitHub Actions
- Frontend: `vercel --prod` hoặc push commit

### 4. Verify Contracts (Optional)

Snowtrace explorer verification (không bắt buộc cho testnet):
```bash
cd packages/contracts
npx hardhat verify --network fuji <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## 🤖 GitHub Actions Workflows

### Current Workflows

**`.github/workflows/ci.yml`** — CI pipeline (chạy trên mọi PR và push):
- Backend tests
- Contracts compilation và tests
- Web typecheck, lint, tests, build

**`.github/workflows/deploy-backend.yml`** — Railway deployment:
- Trigger: push to `main` hoặc manual
- Jobs: test → deploy to Railway
- Cần secrets: `RAILWAY_TOKEN`

**`.github/workflows/deploy-frontend.yml`** — Vercel deployment:
- Trigger: push to `main` hoặc manual
- Jobs: build → deploy to Vercel
- Cần secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### How to Run Manually

1. Vào **Actions** tab
2. Chọn workflow (ví dụ: Deploy Backend)
3. Click **Run workflow**
4. Chọn branch (`main`)
5. Click **Run workflow**

### Monitoring Deployments

**Backend (Railway):**
- Railway dashboard → **Deployments** tab
- Logs: Railway → **View Logs**

**Frontend (Vercel):**
- Vercel dashboard → **Deployments** tab
- Logs: Click deployment → **View Function Logs**

**GitHub Actions:**
- Repository → **Actions** tab
- Click workflow run → xem logs từng job

---

## 🐛 Troubleshooting

### Backend deployment fails

**Lỗi: `DATABASE_URL not found`**
→ Check Railway environment variables, ensure PostgreSQL được add vào project

**Lỗi: `Port already in use`**
→ Railway tự động assign PORT, không cần config

**Lỗi: Build timeout**
→ Railway free tier có giới hạn build time, skip tests: `./mvnw package -DskipTests`

**Lỗi: Health check fails**
→ Check Railway logs, verify `application-prod.yml` config

### Frontend deployment fails

**Lỗi: `Missing required env var NEXT_PUBLIC_API_BASE_URL`**
→ Add environment variable trong Vercel project settings

**Lỗi: Build fails with TypeScript errors**
→ Run `npm run typecheck` locally, fix errors trước khi push

**Lỗi: `Module not found`**
→ Ensure `npm install` chạy trong Vercel build, check `package.json` dependencies

### GitHub Actions fails

**Lỗi: `Secret not found`**
→ Check secret name spelling (case-sensitive), ensure secret được add

**Lỗi: `Railway deploy failed`**
→ Check `RAILWAY_TOKEN` còn valid, check Railway service status

**Lỗi: Tests fail in CI but pass locally**
→ Check environment differences (Java/Node versions), ensure `.env.example` đầy đủ

### Contracts deployment fails

**Lỗi: `Insufficient funds`**
→ Get more AVAX từ faucet

**Lỗi: `Nonce too high`**
→ Reset nonce: send 0 AVAX transaction từ deployer wallet

**Lỗi: `Contract creation code storage out of gas`**
→ Contract quá lớn, enable optimizer trong `hardhat.config.ts`

---

## 📊 Cost Estimation

### Railway (Backend)

**Free tier:**
- $5 credit/month
- 500 hours execution time
- PostgreSQL included
- Good cho development/staging

**Paid (if needed):**
- ~$10-20/month cho production
- Autoscaling
- Backups

### Vercel (Frontend)

**Hobby tier (free):**
- Unlimited deployments
- 100GB bandwidth/month
- Good cho development

**Pro (if needed):**
- $20/month
- Advanced analytics
- More bandwidth

### GitHub Actions

**Free tier:**
- 2000 minutes/month (public repos)
- Unlimited minutes cho public repos
- Enough cho SafeDeal

### Avalanche Fuji

**Free testnet** — không tốn phí thực

---

## ✅ Post-Deployment Checklist

- [ ] Backend health check pass: `curl <railway-url>/api/v1/health`
- [ ] Frontend loads: visit `<vercel-url>`
- [ ] Wallet connection works (MetaMask → Fuji testnet)
- [ ] Backend API calls work (check Network tab)
- [ ] Contract addresses configured đúng
- [ ] Secrets không bị leak trong logs
- [ ] CI/CD workflows pass
- [ ] Monitor Railway/Vercel dashboards

---

## 🔄 Update Workflow

Khi update code:

1. **Develop locally:**
   ```bash
   git checkout -b feature/new-feature
   # code changes
   npm run verify  # hoặc bash scripts/verify.sh
   ```

2. **Push và tạo PR:**
   ```bash
   git push origin feature/new-feature
   # Create PR on GitHub
   ```

3. **CI runs automatically** — ensure all checks pass

4. **Merge PR to main:**
   - GitHub Actions tự động deploy backend (Railway)
   - Vercel tự động deploy frontend

5. **Verify deployment:**
   - Check Railway logs
   - Check Vercel deployment status
   - Test production endpoints

6. **Rollback nếu cần:**
   - Railway: click previous deployment → **Redeploy**
   - Vercel: Deployments → previous → **Promote to Production**

---

## 📚 Resources

- [Railway Docs](https://docs.railway.app/)
- [Vercel Docs](https://vercel.com/docs)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [Avalanche Fuji Faucet](https://core.app/tools/testnet-faucet)
