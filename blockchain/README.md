# SafeDeal Smart Contracts (`blockchain/`)

Foundry-based Solidity smart contracts for native testnet AVAX peer-to-peer escrow on Avalanche Fuji C-Chain (and local Anvil).

## Contract Overview

- `src/SafeDealEscrow.sol` — Non-upgradeable escrow contract enforcing state transitions (`CREATED -> FUNDED -> DELIVERED -> RELEASED`, cancellation, refunds, disputes, and pull-payment withdrawals).
- `src/interfaces/ISafeDealEscrow.sol` — Public ABI interface, events, and structs.
- `script/Deploy.s.sol` — Deployment script reading `DEPLOYER_PRIVATE_KEY` from environment variables.

## Settlement Architecture

SafeDeal strictly separates three settlement phases:
1. **Escrow Settled**: `releaseFunds`, `refundBySeller`, `refundAfterDeadline`, or `resolveDispute` transitions the trade to `RELEASED`, `REFUNDED`, or `RESOLVED` and sets `settled = true`.
2. **Funds Available to Claim**: The contract credits `_claimableBalances[beneficiary]` without transferring AVAX inline, preventing reverting recipient contracts from blocking counterparty settlement.
3. **Funds Successfully Withdrawn**: Beneficiaries invoke `withdraw()` (`nonReentrant`, Checks-Effects-Interactions) to pull their AVAX balance.

## Trust Model

- **Custody & Settlement Rules**: Enforced deterministically on-chain by `SafeDealEscrow`. There is no admin sweep or backdoor withdrawal.
- **Human Arbiter Limitation**: For disputed trades, the designated `arbiter` is a trusted off-chain human decision-maker. If an arbiter becomes permanently unavailable while a trade is `DISPUTED`, funds in that disputed trade remain locked until the arbiter calls `resolveDispute`.

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
