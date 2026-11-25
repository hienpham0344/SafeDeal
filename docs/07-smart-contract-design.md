# Smart Contract Design (`blockchain/`)

## 1. Contract Specification

- **Language / Compiler**: Solidity `0.8.28` (`optimizer = true`, `optimizer_runs = 200`, Foundry, `0` compiler/linter warnings).
- **Dependencies**: OpenZeppelin `ReentrancyGuard`.
- **Source Files**:
  - Implementation: [`blockchain/src/SafeDealEscrow.sol`](../blockchain/src/SafeDealEscrow.sol)
  - Interface & Structs: [`blockchain/src/interfaces/ISafeDealEscrow.sol`](../blockchain/src/interfaces/ISafeDealEscrow.sol)
  - Deployment Script: [`blockchain/script/Deploy.s.sol`](../blockchain/script/Deploy.s.sol)
  - Verified ABI & Deployment Metadata: [`blockchain/deployments/SafeDealEscrow.abi.json`](../blockchain/deployments/SafeDealEscrow.abi.json), [`blockchain/deployments/fuji-43113.json`](../blockchain/deployments/fuji-43113.json)

## 2. Storage Layout & Solvency Accounting

`SafeDealEscrow` maintains five core storage structures:
- `_trades`: `mapping(bytes32 => Trade)` keyed by deterministic `tradeId`.
- `_disputeProposals`: `mapping(bytes32 => mapping(address => bytes32))` storing each participant's (`buyer`, `seller`, `arbiter`) latest split proposal hash `keccak256(abi.encode(buyerAmount, sellerAmount))`.
- `_claimableBalances`: `mapping(address => uint256)` storing pending pull-payment payouts.
- `_totalLockedEscrow`: total AVAX currently held in unsettled `FUNDED`, `DELIVERED`, or `DISPUTED` trades.
- `_totalClaimable`: aggregate sum of all `_claimableBalances`.

### Hard Accounting Invariant

At every block and state transition:

$$\text{address(escrow).balance} \ge \text{\_totalLockedEscrow} + \text{\_totalClaimable}$$

Direct native coin transfers (`receive()` / `fallback()`) revert unconditionally with `DirectTransfersNotAllowed()`, preventing accidental unattributed balance corruption.

## 3. Role Separation & Open-Buyer Binding

1. `createTrade(...)`:
   - Rejects zero `tradeId`, duplicate trades, zero `amount`, zero `termsHash`, `fundingDeadline <= block.timestamp`, `deliveryDeadline <= fundingDeadline`, and `inspectionWindow == 0`.
   - Enforces `arbiter != address(0)` and `arbiter != msg.sender`.
   - If `preassignedBuyer != address(0)`, enforces `preassignedBuyer != msg.sender` and `preassignedBuyer != arbiter`.
2. `fundTrade(bytes32 tradeId)`:
   - Checks `status == CREATED`, `block.timestamp <= fundingDeadline`, and exact `msg.value == trade.amount`.
   - If `trade.buyer == address(0)` (open-buyer trade link), enforces `msg.sender != seller && msg.sender != arbiter` and permanently binds `trade.buyer = msg.sender`.

## 4. Pull-Payment Settlement & Griefing Isolation

All monetary exits (`releaseFunds`, `refundBySeller`, `refundAfterDeadline`, `submitResolutionVote`, `resolveDisputeByTimeout`) update storage strictly inside internal balances (`_totalLockedEscrow -= amount`, `_totalClaimable += amount`, `_claimableBalances[recipient] += amount`) without executing external calls.

Only `withdraw()` sends native AVAX:
1. Enforces OpenZeppelin `nonReentrant`.
2. Reads `amount = _claimableBalances[msg.sender]`, reverts if `0` (`NothingToWithdraw`).
3. Zeros `_claimableBalances[msg.sender] = 0`, decrements `_totalClaimable -= amount`, and emits `FundsWithdrawn(msg.sender, amount)` **before** calling `payable(msg.sender).call{value: amount}("")` (`Checks-Effects-Interactions`).

As a result, if a malicious smart contract recipient intentionally reverts inside `receive()` during a split arbitration payout (`submitResolutionVote` or `resolveDisputeByTimeout`), the honest counterparty still claims their payout cleanly without deadlock.

## 5. 2-of-3 Multi-Party Dispute Consensus, 14-Day Fallback & Inspection Guards

- `cancelUnfundedTrade(tradeId)`: Seller-only escape hatch while `CREATED`.
- `refundAfterDeadline(tradeId)`: Buyer-only reclaim when seller fails to call `markDelivered()` before `block.timestamp > trade.deliveryDeadline`.
- `openDispute(tradeId)` on `DELIVERED`: Buyer can escalate anytime; seller must wait until `block.timestamp > trade.deliveredAt + trade.inspectionWindow` (`InspectionWindowActive` otherwise). Stamping `trade.disputedAt = uint64(block.timestamp)` starts the 14-day dispute clock.
- `submitResolutionVote(bytes32 tradeId, uint256 buyerAmount, uint256 sellerAmount)`:
  - Callable only while `status == DISPUTED` by `trade.buyer`, `trade.seller`, or `trade.arbiter`.
  - Validates `buyerAmount <= trade.amount && sellerAmount == trade.amount - buyerAmount` (`InvalidSplitAmounts` otherwise; `arbiter` receives `0`).
  - Computes `proposalHash = keccak256(abi.encode(buyerAmount, sellerAmount))`, stores `_disputeProposals[tradeId][msg.sender] = proposalHash`, and emits `DisputeVoteSubmitted`.
  - As soon as **any 2 of the 3 participants** (`buyer + seller`, `buyer + arbiter`, or `seller + arbiter`) hold matching `proposalHash` values, the trade settles immediately (`status = RESOLVED`, `settled = true`), credits `_claimableBalances[buyer] += buyerAmount` and `_claimableBalances[seller] += sellerAmount`, and emits `DisputeResolved`.
- `resolveDisputeByTimeout(bytes32 tradeId)`:
  - If 2-of-3 consensus is not reached after `DISPUTE_TIMEOUT` (`14 days`), once `block.timestamp >= uint256(trade.disputedAt) + uint256(DISPUTE_TIMEOUT)` (`DisputeTimeoutNotReached` otherwise), any participant can trigger a deterministic 50/50 split (`buyerAmount = trade.amount / 2`, `sellerAmount = trade.amount - buyerAmount`), guaranteeing zero permanently locked funds even if two parties disappear.

## 6. Foundry Test & Invariant Suites

```bash
forge build --root blockchain --force
forge test --root blockchain -vvv
```

- [`SafeDealEscrow.t.sol`](../blockchain/test/SafeDealEscrow.t.sol) — Unit tests for happy paths, open-buyer binding, voluntary/timeout refunds, cancellation, inspection enforcement, 2-of-3 dispute consensus (`submitResolutionVote`), and 14-day timeout fallback (`resolveDisputeByTimeout`).
- [`EscrowSecurity.t.sol`](../blockchain/test/EscrowSecurity.t.sol) — Attack-contract tests (`ReentrancyAttacker`, `RevertingRecipient`, role escalation, single-vote non-settlement, invalid allocations, direct transfer rejection).
- [`EscrowInvariant.t.sol`](../blockchain/test/EscrowInvariant.t.sol) — Stateful fuzz handler across random actors verifying contract balance solvency and exact claimable balance sums (`64` runs x `32` calls = `2,048` stateful steps).
