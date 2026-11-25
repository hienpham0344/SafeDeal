# SafeDeal Smart Contracts (`blockchain/`)

Foundry-based Solidity smart contracts for native testnet AVAX peer-to-peer escrow on Avalanche Fuji C-Chain (and local Anvil).

## Contract Overview

- `src/SafeDealEscrow.sol` — Non-upgradeable escrow contract enforcing state transitions (`CREATED -> FUNDED -> DELIVERED -> RELEASED`, cancellation, refunds, disputes, and pull-payment withdrawals).
- `src/interfaces/ISafeDealEscrow.sol` — Public ABI interface, events, and structs.
- `script/Deploy.s.sol` — Deployment script reading `DEPLOYER_PRIVATE_KEY` from environment variables.

## Settlement Architecture

SafeDeal strictly separates three settlement phases:
1. **Escrow Settled**: `releaseFunds`, `refundBySeller`, `refundAfterDeadline`, `submitResolutionVote` (upon reaching 2-of-3 consensus), or `resolveDisputeByTimeout` (after the 14-day dispute stalemate window) transitions the trade to `RELEASED`, `REFUNDED`, or `RESOLVED` and sets `settled = true`.
2. **Funds Available to Claim**: The contract credits `_claimableBalances[beneficiary]` without transferring AVAX inline, preventing reverting recipient contracts from blocking counterparty settlement.
3. **Funds Successfully Withdrawn**: Beneficiaries invoke `withdraw()` (`nonReentrant`, Checks-Effects-Interactions) to pull their AVAX balance.

## Trust Model

- **Custody & Settlement Rules**: Enforced deterministically on-chain by `SafeDealEscrow`. There is no admin sweep or backdoor withdrawal.
- **2-of-3 Multi-Party Dispute Consensus & 14-Day Stalemate Fallback**: For disputed trades, settlement requires a **2-of-3 majority vote** (`submitResolutionVote(tradeId, buyerAmount, sellerAmount)`) across `[buyer, seller, arbiter]`, preventing unilateral arbiter collusion and enabling buyer-seller self-settlement without waiting for the arbiter. If no 2-of-3 consensus is reached within `DISPUTE_TIMEOUT` (`14 days`), anyone may invoke `resolveDisputeByTimeout(tradeId)` to execute a deterministic 50/50 split so funds are never permanently locked.

## Commands

```bash
forge build
forge test -vvv
```

### Deploy to Local Anvil

```bash
anvil --port 8545
# In another shell (export one of Anvil's local test-only keys; never use for real funds):
export DEPLOYER_PRIVATE_KEY="<anvil-local-test-private-key>"
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

### Deploy to Avalanche Fuji Testnet

```bash
export FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
export DEPLOYER_PRIVATE_KEY=<your-testnet-deployer-key>
forge script script/Deploy.s.sol:Deploy --rpc-url "$FUJI_RPC_URL" --broadcast
```
