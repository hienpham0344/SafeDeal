// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {SafeDealEscrow} from "../src/SafeDealEscrow.sol";
import {ISafeDealEscrow} from "../src/interfaces/ISafeDealEscrow.sol";

contract EscrowInvariantHandler is Test {
    SafeDealEscrow public immutable escrow;

    address[] public sellers;
    address[] public buyers;
    address[] public arbiters;
    bytes32[] public tradeIds;

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
        address arbiter = arbiters[(seed / 9) % arbiters.length];
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);
        bytes32 tradeId = keccak256(abi.encodePacked("inv", ghostNonce++));
        bytes32 termsHash = keccak256(abi.encodePacked("terms", tradeId));

        uint64 fundingDeadline = uint64(block.timestamp + 1 days);
        uint64 deliveryDeadline = uint64(block.timestamp + 5 days);

        vm.prank(seller);
        escrow.createTrade(tradeId, buyer, arbiter, amount, termsHash, fundingDeadline, deliveryDeadline, 1 days);
        tradeIds.push(tradeId);

        if (fundNow) {
            vm.prank(buyer);
            escrow.fundTrade{value: amount}(tradeId);
        }
    }

    function deliver(uint256 indexSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.FUNDED) return;

        vm.prank(t.seller);
        escrow.markDelivered(tradeId);
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

    function disputeAndResolve(uint256 indexSeed, uint256 splitSeed) external {
        if (tradeIds.length == 0) return;
        bytes32 tradeId = tradeIds[indexSeed % tradeIds.length];
        ISafeDealEscrow.Trade memory t = escrow.getTrade(tradeId);
        if (t.status != ISafeDealEscrow.TradeStatus.FUNDED) return;

        vm.prank(t.buyer);
        escrow.openDispute(tradeId);

        uint256 buyerShare = splitSeed % (t.amount + 1);
        uint256 sellerShare = t.amount - buyerShare;
        vm.prank(t.arbiter);
        escrow.resolveDispute(tradeId, buyerShare, sellerShare);
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
    }
}
