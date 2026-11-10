# SafeDeal Frontend (React + Vite + TypeScript + Tailwind CSS)

Non-custodial Avalanche P2P escrow client preserving the Foldcraft editorial landing hero at `/` and providing dedicated transaction, dispute, and arbitration routes.

## Routes

- `/` — Foldcraft hero landing experience (`LandingPage`)
- `/how-it-works` — Escrow lifecycle & trust limitation overview
- `/support` — Live backend health & active network/contract verification
- `/create` — RFC 8785 canonical deal drafting & `createTrade` submission
- `/deals/:id` — Role-gated escrow actions (`fundTrade`, `markDelivered`, `releaseFunds`, refunds, cancel, `withdraw`)
- `/dashboard` — Participant deal filters & pull-payment withdrawal
- `/disputes/:id` — Dispute timeline & evidence submission/download
- `/arbiter` — Arbiter settlement console (`resolveDispute`)

## Commands

```bash
cp .env.example .env
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```
