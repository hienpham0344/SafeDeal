// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISafeDealEscrow} from "./interfaces/ISafeDealEscrow.sol";

/**
 * @title SafeDealEscrow
 * @notice Non-upgradeable, native-AVAX peer-to-peer escrow contract using pull-payment settlement.
 *
 * Lifecycle:
 *   CREATED -> FUNDED -> DELIVERED -> RELEASED
 *   CREATED -> CANCELLED
 *   FUNDED -> REFUNDED
 *   FUNDED -> DISPUTED -> RESOLVED
 *   DELIVERED -> DISPUTED -> RESOLVED
 *
 * Security model:
 * - No admin custody or arbitrary fund recovery.
 * - Pull-payment withdrawals isolate failed recipient transfers so one party's reverting fallback
 *   never blocks settlement or the counterparty's withdrawal.
 * - A human arbiter resolves disputes within strict allocation invariants and cannot receive funds.
 */
contract SafeDealEscrow is ISafeDealEscrow, ReentrancyGuard {
    mapping(bytes32 => Trade) private _trades;
    mapping(address => uint256) private _claimableBalances;
    uint256 private _totalLockedEscrow;
    uint256 private _totalClaimable;

    error InvalidTradeId();
    error InvalidAmount();
    error InvalidTermsHash();
    error ZeroAddress(string role);
    error InvalidRoleSeparation(string reason);
    error InvalidDeadline(string field);
    error TradeAlreadyExists(bytes32 tradeId);
    error TradeNotFound(bytes32 tradeId);
    error InvalidState(TradeStatus current, TradeStatus expected);
    error UnauthorizedCaller(address caller);
    error FundingDeadlinePassed(uint64 fundingDeadline, uint64 currentTimestamp);
    error DeliveryDeadlineNotReached(uint64 deliveryDeadline, uint64 currentTimestamp);
    error InspectionWindowActive(uint64 unlocksAt, uint64 currentTimestamp);
    error IncorrectPaymentAmount(uint256 expected, uint256 actual);
    error AlreadySettled(bytes32 tradeId);
    error InvalidSettlementAllocation(uint256 expectedTotal, uint256 buyerAmount, uint256 sellerAmount);
    error NothingToWithdraw();
    error WithdrawalTransferFailed();
    error DirectTransfersNotAllowed();

    receive() external payable {
        revert DirectTransfersNotAllowed();
    }

    fallback() external payable {
        revert DirectTransfersNotAllowed();
    }

    function createTrade(
        bytes32 tradeId,
        address preassignedBuyer,
        address arbiter,
        uint256 amount,
        bytes32 termsHash,
        uint64 fundingDeadline,
        uint64 deliveryDeadline,
        uint64 inspectionWindow
    ) external {
        if (tradeId == bytes32(0)) revert InvalidTradeId();
        if (_trades[tradeId].status != TradeStatus.NONE) revert TradeAlreadyExists(tradeId);
        if (arbiter == address(0)) revert ZeroAddress("arbiter");
        if (arbiter == msg.sender) revert InvalidRoleSeparation("arbiter-equals-seller");
        if (preassignedBuyer != address(0)) {
            if (preassignedBuyer == msg.sender) revert InvalidRoleSeparation("buyer-equals-seller");
            if (preassignedBuyer == arbiter) revert InvalidRoleSeparation("buyer-equals-arbiter");
        }
        if (amount == 0) revert InvalidAmount();
        if (termsHash == bytes32(0)) revert InvalidTermsHash();
        if (fundingDeadline <= block.timestamp) revert InvalidDeadline("fundingDeadline");
        if (deliveryDeadline <= fundingDeadline) revert InvalidDeadline("deliveryDeadline");
        if (inspectionWindow == 0) revert InvalidDeadline("inspectionWindow");

        _trades[tradeId] = Trade({
            tradeId: tradeId,
            seller: msg.sender,
            buyer: preassignedBuyer,
            arbiter: arbiter,
            amount: amount,
            termsHash: termsHash,
            createdAt: uint64(block.timestamp),
            fundedAt: 0,
            deliveredAt: 0,
            fundingDeadline: fundingDeadline,
            deliveryDeadline: deliveryDeadline,
            inspectionWindow: inspectionWindow,
            status: TradeStatus.CREATED,
            settled: false
        });

        emit TradeCreated(
            tradeId,
            msg.sender,
            preassignedBuyer,
            arbiter,
            amount,
            termsHash,
            fundingDeadline,
            deliveryDeadline,
            inspectionWindow
        );
    }

    function cancelUnfundedTrade(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.status != TradeStatus.CREATED) {
            revert InvalidState(trade.status, TradeStatus.CREATED);
        }
        if (msg.sender != trade.seller) revert UnauthorizedCaller(msg.sender);

        trade.status = TradeStatus.CANCELLED;
        emit TradeCancelled(tradeId, msg.sender);
    }

    function fundTrade(bytes32 tradeId) external payable nonReentrant {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.status != TradeStatus.CREATED) {
            revert InvalidState(trade.status, TradeStatus.CREATED);
        }
        if (block.timestamp > trade.fundingDeadline) {
            revert FundingDeadlinePassed(trade.fundingDeadline, uint64(block.timestamp));
        }

        if (trade.buyer != address(0)) {
            if (msg.sender != trade.buyer) revert UnauthorizedCaller(msg.sender);
        } else {
            if (msg.sender == trade.seller) revert InvalidRoleSeparation("buyer-equals-seller");
            if (msg.sender == trade.arbiter) revert InvalidRoleSeparation("buyer-equals-arbiter");
            trade.buyer = msg.sender;
        }

        if (msg.value != trade.amount) {
            revert IncorrectPaymentAmount(trade.amount, msg.value);
        }

        trade.status = TradeStatus.FUNDED;
        trade.fundedAt = uint64(block.timestamp);
        _totalLockedEscrow += msg.value;

        emit TradeFunded(tradeId, msg.sender, msg.value);
    }

    function markDelivered(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.status != TradeStatus.FUNDED) {
            revert InvalidState(trade.status, TradeStatus.FUNDED);
        }
        if (msg.sender != trade.seller) revert UnauthorizedCaller(msg.sender);

        trade.status = TradeStatus.DELIVERED;
        trade.deliveredAt = uint64(block.timestamp);

        emit DeliveryMarked(tradeId, msg.sender, trade.deliveredAt);
    }

    function releaseFunds(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.settled) revert AlreadySettled(tradeId);
        if (trade.status != TradeStatus.DELIVERED) {
            revert InvalidState(trade.status, TradeStatus.DELIVERED);
        }
        if (msg.sender != trade.buyer) revert UnauthorizedCaller(msg.sender);

        trade.status = TradeStatus.RELEASED;
        trade.settled = true;
        _totalLockedEscrow -= trade.amount;
        _totalClaimable += trade.amount;
        _claimableBalances[trade.seller] += trade.amount;

        emit FundsReleased(tradeId, trade.seller, trade.amount);
    }

    function refundBySeller(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.settled) revert AlreadySettled(tradeId);
        if (trade.status != TradeStatus.FUNDED) {
            revert InvalidState(trade.status, TradeStatus.FUNDED);
        }
        if (msg.sender != trade.seller) revert UnauthorizedCaller(msg.sender);

        trade.status = TradeStatus.REFUNDED;
        trade.settled = true;
        _totalLockedEscrow -= trade.amount;
        _totalClaimable += trade.amount;
        _claimableBalances[trade.buyer] += trade.amount;

        emit RefundExecuted(tradeId, trade.buyer, trade.amount, msg.sender);
    }

    function refundAfterDeadline(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.settled) revert AlreadySettled(tradeId);
        if (trade.status != TradeStatus.FUNDED) {
            revert InvalidState(trade.status, TradeStatus.FUNDED);
        }
        if (msg.sender != trade.buyer) revert UnauthorizedCaller(msg.sender);
        if (block.timestamp <= trade.deliveryDeadline) {
            revert DeliveryDeadlineNotReached(trade.deliveryDeadline, uint64(block.timestamp));
        }

        trade.status = TradeStatus.REFUNDED;
        trade.settled = true;
        _totalLockedEscrow -= trade.amount;
        _totalClaimable += trade.amount;
        _claimableBalances[trade.buyer] += trade.amount;

        emit RefundExecuted(tradeId, trade.buyer, trade.amount, msg.sender);
    }

    function openDispute(bytes32 tradeId) external {
        Trade storage trade = _requireExistingTrade(tradeId);

        if (trade.status == TradeStatus.FUNDED) {
            if (msg.sender != trade.buyer && msg.sender != trade.seller) {
                revert UnauthorizedCaller(msg.sender);
            }
        } else if (trade.status == TradeStatus.DELIVERED) {
            if (msg.sender == trade.buyer) {
                // Buyer may raise a dispute anytime during or after inspection while DELIVERED.
            } else if (msg.sender == trade.seller) {
                uint256 unlocksAt = uint256(trade.deliveredAt) + uint256(trade.inspectionWindow);
                if (block.timestamp <= unlocksAt) {
                    uint64 cappedUnlocksAt = unlocksAt > type(uint64).max ? type(uint64).max : uint64(unlocksAt);
                    revert InspectionWindowActive(cappedUnlocksAt, uint64(block.timestamp));
                }
            } else {
                revert UnauthorizedCaller(msg.sender);
            }
        } else {
            revert InvalidState(trade.status, TradeStatus.FUNDED);
        }

        trade.status = TradeStatus.DISPUTED;
        emit DisputeOpened(tradeId, msg.sender);
    }

    function resolveDispute(bytes32 tradeId, uint256 buyerAmount, uint256 sellerAmount) external {
        Trade storage trade = _requireExistingTrade(tradeId);
        if (trade.settled) revert AlreadySettled(tradeId);
        if (trade.status != TradeStatus.DISPUTED) {
            revert InvalidState(trade.status, TradeStatus.DISPUTED);
        }
        if (msg.sender != trade.arbiter) revert UnauthorizedCaller(msg.sender);

        if (buyerAmount > trade.amount || sellerAmount != trade.amount - buyerAmount) {
            revert InvalidSettlementAllocation(trade.amount, buyerAmount, sellerAmount);
        }

        trade.status = TradeStatus.RESOLVED;
        trade.settled = true;
        _totalLockedEscrow -= trade.amount;
        _totalClaimable += trade.amount;

        if (buyerAmount > 0) {
            _claimableBalances[trade.buyer] += buyerAmount;
        }
        if (sellerAmount > 0) {
            _claimableBalances[trade.seller] += sellerAmount;
        }

        emit DisputeResolved(tradeId, msg.sender, trade.buyer, buyerAmount, trade.seller, sellerAmount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = _claimableBalances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        _claimableBalances[msg.sender] = 0;
        _totalClaimable -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawalTransferFailed();

        emit FundsWithdrawn(msg.sender, amount);
    }

    function getTrade(bytes32 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    function claimableBalances(address account) external view returns (uint256) {
        return _claimableBalances[account];
    }

    function totalLockedEscrow() external view returns (uint256) {
        return _totalLockedEscrow;
    }

    function totalClaimable() external view returns (uint256) {
        return _totalClaimable;
    }

    function _requireExistingTrade(bytes32 tradeId) private view returns (Trade storage trade) {
        trade = _trades[tradeId];
        if (trade.status == TradeStatus.NONE) revert TradeNotFound(tradeId);
    }
}
