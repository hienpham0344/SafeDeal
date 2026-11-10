// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SafeDealEscrow} from "../src/SafeDealEscrow.sol";
import {ISafeDealEscrow} from "../src/interfaces/ISafeDealEscrow.sol";

contract ReentrancyAttacker {
    SafeDealEscrow public immutable escrow;
    uint256 public attackCount;

    constructor(SafeDealEscrow _escrow) {
        escrow = _escrow;
    }

    function createAndWaitForSettlement(
        bytes32 tradeId,
        address buyer,
        address arbiter,
        uint256 amount,
        bytes32 termsHash,
        uint64 fundingDeadline,
        uint64 deliveryDeadline,
        uint64 inspectionWindow
    ) external {
        escrow.createTrade(
            tradeId,
            buyer,
            arbiter,
            amount,
            termsHash,
            fundingDeadline,
            deliveryDeadline,
            inspectionWindow
        );
    }

    function markDelivered(bytes32 tradeId) external {
        escrow.markDelivered(tradeId);
    }

    function attackWithdraw() external {
        escrow.withdraw();
    }

    receive() external payable {
        if (attackCount < 2) {
            attackCount++;
            escrow.withdraw();
        }
    }
}

contract RevertingReceiver {
    receive() external payable {
        revert("cannot receive native AVAX");
    }

    function fund(SafeDealEscrow escrow, bytes32 tradeId) external payable {
        escrow.fundTrade{value: msg.value}(tradeId);
    }

    function openDispute(SafeDealEscrow escrow, bytes32 tradeId) external {
        escrow.openDispute(tradeId);
    }

    function tryWithdraw(SafeDealEscrow escrow) external {
        escrow.withdraw();
    }
}

contract EscrowSecurityTest is Test {
    SafeDealEscrow internal escrow;
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal arbiter = makeAddr("arbiter");
    bytes32 internal constant TERMS_HASH = keccak256("security-terms");

    function setUp() public {
        escrow = new SafeDealEscrow();
        vm.deal(seller, 20 ether);
        vm.deal(buyer, 20 ether);
    }

    function testReentrancyOnWithdrawIsBlocked() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(escrow);
        bytes32 tradeId = keccak256("reenter-trade");

        // Also fund a second innocent trade so the contract holds extra balance worth stealing
        bytes32 innocentId = keccak256("innocent-trade");
        vm.prank(seller);
        escrow.createTrade(
            innocentId,
            buyer,
            arbiter,
            5 ether,
            TERMS_HASH,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 5 days),
            1 days
        );
        vm.prank(buyer);
        escrow.fundTrade{value: 5 ether}(innocentId);

        attacker.createAndWaitForSettlement(
            tradeId,
            buyer,
            arbiter,
            1 ether,
            TERMS_HASH,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 5 days),
            1 days
        );
        vm.prank(buyer);
        escrow.fundTrade{value: 1 ether}(tradeId);
        attacker.markDelivered(tradeId);
        vm.prank(buyer);
        escrow.releaseFunds(tradeId);

        // Reentrancy attempt causes inner withdraw to revert, failing the outer call cleanly
        vm.expectRevert(SafeDealEscrow.WithdrawalTransferFailed.selector);
        attacker.attackWithdraw();

        // Balance of innocent trade remains intact
        assertEq(address(escrow).balance, 6 ether);
        assertEq(escrow.claimableBalances(address(attacker)), 1 ether);
    }

    function testWithdrawalFailureDoesNotBlockCounterpartyOrSettlement() public {
        RevertingReceiver badBuyer = new RevertingReceiver();
        vm.deal(address(badBuyer), 5 ether);

        bytes32 tradeId = keccak256("split-trade");
        vm.prank(seller);
        escrow.createTrade(
            tradeId,
            address(badBuyer),
            arbiter,
            4 ether,
            TERMS_HASH,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 5 days),
            1 days
        );

        badBuyer.fund{value: 4 ether}(escrow, tradeId);
        badBuyer.openDispute(escrow, tradeId);

        // Arbiter splits 1 ether to badBuyer and 3 ether to seller
        vm.prank(arbiter);
        escrow.resolveDispute(tradeId, 1 ether, 3 ether);

        // badBuyer's withdraw fails, but state remains settled
        vm.expectRevert(SafeDealEscrow.WithdrawalTransferFailed.selector);
        badBuyer.tryWithdraw(escrow);

        // Seller can still withdraw their 3 ether cleanly
        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        escrow.withdraw();
        assertEq(seller.balance, sellerBefore + 3 ether);
        assertEq(escrow.claimableBalances(address(badBuyer)), 1 ether);
    }

    function testCannotDoubleSettleOrReopenResolvedDispute() public {
        bytes32 tradeId = keccak256("double-settle");
        vm.prank(seller);
        escrow.createTrade(
            tradeId,
            buyer,
            arbiter,
            2 ether,
            TERMS_HASH,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 5 days),
            1 days
        );
        vm.prank(buyer);
        escrow.fundTrade{value: 2 ether}(tradeId);
        vm.prank(buyer);
        escrow.openDispute(tradeId);

        vm.prank(arbiter);
        escrow.resolveDispute(tradeId, 1 ether, 1 ether);

        // Cannot resolve again
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.AlreadySettled.selector, tradeId));
        escrow.resolveDispute(tradeId, 1 ether, 1 ether);

        // Cannot reopen dispute
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InvalidState.selector,
                ISafeDealEscrow.TradeStatus.RESOLVED,
                ISafeDealEscrow.TradeStatus.FUNDED
            )
        );
        escrow.openDispute(tradeId);
    }

    function testRejectsInvalidDisputeAllocationSums() public {
        bytes32 tradeId = keccak256("bad-split");
        vm.prank(seller);
        escrow.createTrade(
            tradeId,
            buyer,
            arbiter,
            2 ether,
            TERMS_HASH,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 5 days),
            1 days
        );
        vm.prank(buyer);
        escrow.fundTrade{value: 2 ether}(tradeId);
        vm.prank(buyer);
        escrow.openDispute(tradeId);

        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InvalidSettlementAllocation.selector,
                2 ether,
                1 ether,
                0.5 ether
            )
        );
        escrow.resolveDispute(tradeId, 1 ether, 0.5 ether);

        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InvalidSettlementAllocation.selector,
                2 ether,
                2.5 ether,
                0
            )
        );
        escrow.resolveDispute(tradeId, 2.5 ether, 0);
    }

    function testRejectsDirectNativeTransfersAndEmptyWithdrawals() public {
        (bool ok,) = payable(address(escrow)).call{value: 1 ether}("");
        assertFalse(ok);

        vm.prank(seller);
        vm.expectRevert(SafeDealEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }
}
