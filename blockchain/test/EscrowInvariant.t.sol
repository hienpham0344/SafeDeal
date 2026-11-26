// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {SafeDealEscrow} from "../src/SafeDealEscrow.sol";
import {ISafeDealEscrow} from "../src/interfaces/ISafeDealEscrow.sol";

contract EscrowInvariantHandler is Test {
    SafeDealEscrow public immutable escrow;
    address public constant OUTSIDER = address(0x9999);

    struct LastProposal {
        bool exists;
        uint256 buyerShare;
        uint256 sellerShare;
    }

    address[] public sellers;
    address[] public buyers;
    address[] public arbiters;
    bytes32[] public tradeIds;
    mapping(bytes32 => LastProposal) public lastProposals;

    uint256 public ghostNonce;

    constructor(SafeDealEscrow _escrow) {
        escrow = _escrow;
        for (uint256 i = 0; i < 3; i++) {
            address s = address(uint160(0x1000 + i));
            address b = address(uint160(0x2000 + i));
            address a = address(uint160(0x3000 + i));
            sellers.push(s);
            buyers.push(b);
            arbiters.push(a);
            vm.deal(s, 1000 ether);
            vm.deal(b, 1000 ether);
        }
    }

    function createAndMaybeFund(uint256 seed, uint96 rawAmount, bool fundNow) external {
        address seller = sellers[seed % sellers.length];
        address buyer = buyers[(seed / 3) % buyers.length];
        address preassignedBuyer = (seed % 4 == 0) ? address(0) : buyer;
        address arbiter = arbiters[(seed / 9) % arbiters.length];
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        bytes32 tradeId = keccak256(abi.encodePacked("inv", ghostNonce++));
        bytes32 termsHash = keccak256(abi.encodePacked("terms", tradeId));

        uint64 fundingDeadline = uint64(block.timestamp + 1 days);
        uint64 deliveryDeadline = uint64(block.timestamp + 5 days);

        vm.prank(seller);
        escrow.createTrade(tradeId, preassignedBuyer, arbiter, amount, termsHash, fundingDeadline, deliveryDeadline, 1 days);
        tradeIds.push(tradeId);

        if (fundNow) {
            vm.prank(buyer);
            escrow.fundTrade{value: amount}(tradeId);
        }
    }

    function fundCreated(uint256 indexSeed, uint256 buyerSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.CREATED) return;
        if (block.timestamp > t.fundingDeadline) return;

        address payer = t.buyer != address(0) ? t.buyer : buyers[buyerSeed % buyers.length];
        vm.prank(payer);
        escrow.fundTrade{value: t.amount}(tradeId);
    }

    function cancelUnfunded(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.CREATED) return;

        vm.prank(t.seller);
        escrow.cancelUnfundedTrade(tradeId);
    }

    function deliver(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.FUNDED) return;
        if (block.timestamp > t.deliveryDeadline) return;

        vm.prank(t.seller);
        escrow.markDelivered(tradeId);
    }

    function refundAfterDeadline(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.FUNDED) return;

        if (block.timestamp <= t.deliveryDeadline) {
            vm.warp(uint256(t.deliveryDeadline) + 1);
        }
        vm.prank(t.buyer);
        escrow.refundAfterDeadline(tradeId);
    }

    function release(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.DELIVERED) return;

        vm.prank(t.buyer);
        escrow.releaseFunds(tradeId);
    }

    function refundBySeller(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.FUNDED) return;

        vm.prank(t.seller);
        escrow.refundBySeller(tradeId);
    }

    function openDisputeAsBuyer(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (
            t.status != ISafeDealEscrow.TradeStatus.FUNDED
                && t.status != ISafeDealEscrow.TradeStatus.DELIVERED
        ) return;

        vm.prank(t.buyer);
        escrow.openDispute(tradeId);
    }

    function openDisputeAsSeller(uint256 indexSeed, bool warpPastInspection) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);

        if (t.status == ISafeDealEscrow.TradeStatus.FUNDED) {
            if (block.timestamp > t.deliveryDeadline) return;
            vm.prank(t.seller);
            escrow.openDispute(tradeId);
        } else if (t.status == ISafeDealEscrow.TradeStatus.DELIVERED) {
            uint256 unlocksAt = uint256(t.deliveredAt) + uint256(t.inspectionWindow);
            if (block.timestamp <= unlocksAt) {
                if (!warpPastInspection) return;
                vm.warp(unlocksAt + 1);
            }
            vm.prank(t.seller);
            escrow.openDispute(tradeId);
        }
    }

    function submitOrOverwriteDisputeVote(
        uint256 indexSeed,
        uint8 voterSeed,
        uint256 splitSeed,
        bool matchLastProposal
    ) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.DISPUTED) return;

        uint8 role = voterSeed % 3;
        address voter = role == 0 ? t.buyer : (role == 1 ? t.seller : t.arbiter);

        uint256 buyerShare;
        uint256 sellerShare;
        LastProposal memory prev = lastProposals[tradeId];
        if (matchLastProposal && prev.exists) {
            buyerShare = prev.buyerShare;
            sellerShare = prev.sellerShare;
        } else {
            buyerShare = splitSeed % (t.amount + 1);
            sellerShare = t.amount - buyerShare;
            lastProposals[tradeId] = LastProposal({exists: true, buyerShare: buyerShare, sellerShare: sellerShare});
        }

        vm.prank(voter);
        escrow.submitResolutionVote(tradeId, buyerShare, sellerShare);
    }

    function resolveDisputeByTimeout(uint256 indexSeed, uint8 callerSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.DISPUTED) return;

        uint256 timeoutAt = uint256(t.disputedAt) + uint256(escrow.DISPUTE_TIMEOUT());
        if (block.timestamp <= timeoutAt) {
            vm.warp(timeoutAt + 1);
        }

        uint8 callerChoice = callerSeed % 4;
        address caller = callerChoice == 0
            ? t.buyer
            : (callerChoice == 1 ? t.seller : (callerChoice == 2 ? t.arbiter : OUTSIDER));

        vm.prank(caller);
        escrow.resolveDisputeByTimeout(tradeId);
    }

    function disputeAndResolve(
        uint256 indexSeed,
        uint256 splitSeed,
        uint256 overwriteSeed,
        bool sellerInitiates
    ) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);

        if (
            t.status == ISafeDealEscrow.TradeStatus.FUNDED
                || t.status == ISafeDealEscrow.TradeStatus.DELIVERED
        ) {
            if (sellerInitiates) {
                if (
                    t.status == ISafeDealEscrow.TradeStatus.FUNDED
                        && vm.getBlockTimestamp() <= t.deliveryDeadline
                ) {
                    vm.prank(t.seller);
                    escrow.openDispute(tradeId);
                } else if (t.status == ISafeDealEscrow.TradeStatus.DELIVERED) {
                    uint256 unlocksAt = uint256(t.deliveredAt) + uint256(t.inspectionWindow);
                    if (vm.getBlockTimestamp() <= unlocksAt) {
                        vm.warp(unlocksAt + 1);
                    }
                    vm.prank(t.seller);
                    escrow.openDispute(tradeId);
                } else {
                    vm.prank(t.buyer);
                    escrow.openDispute(tradeId);
                }
            } else {
                vm.prank(t.buyer);
                escrow.openDispute(tradeId);
            }
            t = escrow.getTrade(tradeId);
        } else if (t.status != ISafeDealEscrow.TradeStatus.DISPUTED) {
            return;
        }

        // Interleaved diverging votes + vote overwrite before consensus or timeout
        uint256 buyerShareA = splitSeed % (t.amount + 1);
        uint256 buyerShareB = (buyerShareA + 1) % (t.amount + 1);
        uint256 buyerShareC = overwriteSeed % (t.amount + 1);

        // Clear/set buyer & seller to two distinct proposals so trade remains DISPUTED
        vm.prank(t.arbiter);
        escrow.submitResolutionVote(tradeId, buyerShareA, t.amount - buyerShareA);
        if (escrow.getTrade(tradeId).status != ISafeDealEscrow.TradeStatus.DISPUTED) return;

        vm.prank(t.seller);
        escrow.submitResolutionVote(tradeId, buyerShareB, t.amount - buyerShareB);
        if (escrow.getTrade(tradeId).status != ISafeDealEscrow.TradeStatus.DISPUTED) return;

        // Arbiter overwrites prior vote A -> C
        vm.prank(t.arbiter);
        escrow.submitResolutionVote(tradeId, buyerShareC, t.amount - buyerShareC);
        if (escrow.getTrade(tradeId).status != ISafeDealEscrow.TradeStatus.DISPUTED) return;

        if (splitSeed % 3 == 0) {
            uint256 timeoutAt = uint256(t.disputedAt) + uint256(escrow.DISPUTE_TIMEOUT());
            if (block.timestamp <= timeoutAt) {
                vm.warp(timeoutAt + 1);
            }
            vm.prank(overwriteSeed % 2 == 0 ? t.seller : OUTSIDER);
            escrow.resolveDisputeByTimeout(tradeId);
        } else {
            // Buyer casts matching vote C (after first testing a non-matching vote A if A != B && A != C)
            if (buyerShareA != buyerShareB && buyerShareA != buyerShareC) {
                vm.prank(t.buyer);
                escrow.submitResolutionVote(tradeId, buyerShareA, t.amount - buyerShareA);
                assertEq(uint8(escrow.getTrade(tradeId).status), uint8(ISafeDealEscrow.TradeStatus.DISPUTED));
            }
            // Buyer overwrites vote to C to reach 2-of-3 consensus with arbiter
            vm.prank(t.buyer);
            escrow.submitResolutionVote(tradeId, buyerShareC, t.amount - buyerShareC);
        }
    }

    function withdrawActor(uint256 actorSeed) external {
        address actor = actorSeed % 2 == 0
            ? sellers[actorSeed % sellers.length]
            : buyers[actorSeed % buyers.length];
        if (escrow.claimableBalances(actor) == 0) return;

        vm.prank(actor);
        escrow.withdraw();
    }

    function tradeCount() external view returns (uint256) {
        return tradeIds.length;
    }

    function sumActorClaimables() external view returns (uint256 total) {
        for (uint256 i = 0; i < sellers.length; i++) {
            total += escrow.claimableBalances(sellers[i]);
            total += escrow.claimableBalances(buyers[i]);
            total += escrow.claimableBalances(arbiters[i]);
        }
        total += escrow.claimableBalances(OUTSIDER);
    }

    function sumActiveEscrows() external view returns (uint256 total) {
        for (uint256 i = 0; i < tradeIds.length; i++) {
            ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeIds[i]);
            if (
                t.status == ISafeDealEscrow.TradeStatus.FUNDED
                    || t.status == ISafeDealEscrow.TradeStatus.DELIVERED
                    || t.status == ISafeDealEscrow.TradeStatus.DISPUTED
            ) {
                total += t.amount;
            }
        }
    }
}

contract EscrowInvariantTest is StdInvariant, Test {
    SafeDealEscrow internal escrow;
    EscrowInvariantHandler internal handler;

    function setUp() public {
        escrow = new SafeDealEscrow();
        handler = new EscrowInvariantHandler(escrow);
        targetContract(address(handler));
    }

    function invariant_contractBalanceMatchesEscrowPlusClaimable() public view {
        uint256 activeLocked = handler.sumActiveEscrows();
        uint256 actorClaimables = handler.sumActorClaimables();

        assertEq(escrow.totalLockedEscrow(), activeLocked);
        assertEq(escrow.totalClaimable(), actorClaimables);
        assertEq(address(escrow).balance, activeLocked + actorClaimables);
    }

    function invariant_arbitersNeverReceiveClaimableFunds() public view {
        for (uint256 i = 0; i < 3; i++) {
            assertEq(escrow.claimableBalances(handler.arbiters(i)), 0);
        }
        assertEq(escrow.claimableBalances(handler.OUTSIDER()), 0);
    }
}
