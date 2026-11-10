# Smart Contract Design (`blockchain/`)

## 1. Contract Specification

- **Language / Compiler**: Solidity `0.8.28` (`optimizer = true`, `optimizer_runs = 200`, Foundry).
- **Dependencies**: OpenZeppelin `ReentrancyGuard`.
- **Source Files**:
  - Implementation: [`blockchain/src/SafeDealEscrow.sol`](../blockchain/src/SafeDealEscrow.sol)
  - Interface & Structs: [`blockchain/src/interfaces/ISafeDealEscrow.sol`](../blockchain/src/interfaces/ISafeDealEscrow.sol)
  - Deployment Script: [`blockchain/script/Deploy.s.sol`](../blockchain/script/Deploy.s.sol)

## 2. Storage Layout & Solvency Accounting

`SafeDealEscrow` maintains four state storage variables:
- `_trades`: `mapping(bytes32 => Trade)` keyed by deterministic `tradeId`.
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

All monetary exits (`releaseFunds`, `refundBySeller`, `refundAfterDeadline`, `resolveDispute`) update storage strictly inside internal balances (`_totalLockedEscrow -= amount`, `_totalClaimable += amount`, `_claimableBalances[recipient] += amount`) without executing external calls.

Only `withdraw()` sends native AVAX:
1. Enforces OpenZeppelin `nonReentrant`.
2. Reads `amount = _claimableBalances[msg.sender]`, reverts if `0` (`NothingToWithdraw`).
3. Zeros `_claimableBalances[msg.sender] = 0` and decrements `_totalClaimable -= amount` **before** calling `payable(msg.sender).call{value: amount}("")` (`Checks-Effects-Interactions`).

As a result, if a malicious smart contract recipient intentionally reverts inside `receive()` during a split arbitration payout (`resolveDispute`), the honest counterparty still claims their payout cleanly without deadlock.

## 5. Deadline & Inspection Guards

- `cancelUnfundedTrade(tradeId)`: Seller-only escape hatch while `CREATED`.
- `refundAfterDeadline(tradeId)`: Buyer-only reclaim when seller fails to call `markDelivered()` before `block.timestamp > trade.deliveryDeadline`.
- `openDispute(tradeId)` on `DELIVERED`: Buyer can escalate anytime; seller must wait until `block.timestamp > trade.deliveredAt + trade.inspectionWindow` (`InspectionWindowActive` otherwise).

## 6. Foundry Test & Invariant Suites

```bash
forge test --root blockchain -vvv
```

- [`SafeDealEscrow.t.sol`](../blockchain/test/SafeDealEscrow.t.sol) — Unit tests for happy paths, open-buyer binding, voluntary/timeout refunds, cancellation, inspection enforcement, and split arbitration.
- [`EscrowSecurity.t.sol`](../blockchain/test/EscrowSecurity.t.sol) — Attack-contract tests (`ReentrancyAttacker`, `RevertingRecipient`, role escalation, invalid allocations, direct transfer rejection).
- [`EscrowInvariant.t.sol`](../blockchain/test/EscrowInvariant.t.sol) — Stateful fuzz handler across random actors verifying contract balance solvency and exact claimable balance sums (`64` runs x `32` calls = `2,048` stateful steps).
