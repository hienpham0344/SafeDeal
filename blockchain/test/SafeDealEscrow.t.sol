// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SafeDealEscrow} from "../src/SafeDealEscrow.sol";
import {ISafeDealEscrow} from "../src/interfaces/ISafeDealEscrow.sol";

contract SafeDealEscrowTest is Test {
    SafeDealEscrow internal escrow;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal otherBuyer = makeAddr("otherBuyer");
    address internal arbiter = makeAddr("arbiter");
    address internal outsider = makeAddr("outsider");

    bytes32 internal constant TRADE_ID = keccak256("deal-001");
    bytes32 internal constant TRADE_ID_2 = keccak256("deal-002");
    bytes32 internal constant TERMS_HASH = keccak256("canonical-terms-v1");
    uint256 internal constant AMOUNT = 2 ether;
    uint64 internal constant INSPECTION_WINDOW = 3 days;

    function setUp() public {
        escrow = new SafeDealEscrow();
        vm.deal(seller, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.deal(otherBuyer, 10 ether);
        vm.deal(arbiter, 10 ether);
    }

    function _createDefaultTrade(bytes32 tradeId, address preassignedBuyer)
        internal
        returns (uint64 fundingDeadline, uint64 deliveryDeadline)
    {
        fundingDeadline = uint64(block.timestamp + 1 days);
        deliveryDeadline = uint64(block.timestamp + 7 days);

        vm.prank(seller);
        escrow.createTrade(
            tradeId,
            preassignedBuyer,
            arbiter,
            AMOUNT,
            TERMS_HASH,
            fundingDeadline,
            deliveryDeadline,
            INSPECTION_WINDOW
        );
    }

    function testHappyPathPreassignedBuyerAndPullWithdraw() public {
        _createDefaultTrade(TRADE_ID, buyer);

        ISafeDealEscrow.Trade memory t = escrow.getTrade(TRADE_ID);
        assertEq(uint8(t.status), uint8(ISafeDealEscrow.TradeStatus.CREATED));
        assertEq(t.seller, seller);
        assertEq(t.buyer, buyer);
        assertEq(t.arbiter, arbiter);
        assertEq(t.amount, AMOUNT);

        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);
        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.FUNDED));
        assertEq(escrow.totalLockedEscrow(), AMOUNT);

        vm.prank(seller);
        escrow.markDelivered(TRADE_ID);
        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.DELIVERED));

        vm.prank(buyer);
        escrow.releaseFunds(TRADE_ID);

        t = escrow.getTrade(TRADE_ID);
        assertEq(uint8(t.status), uint8(ISafeDealEscrow.TradeStatus.RELEASED));
        assertTrue(t.settled);
        assertEq(escrow.totalLockedEscrow(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
        assertEq(escrow.claimableBalances(seller), AMOUNT);

        uint256 sellerBefore = seller.balance;
        vm.prank(seller);
        escrow.withdraw();

        assertEq(seller.balance, sellerBefore + AMOUNT);
        assertEq(escrow.claimableBalances(seller), 0);
        assertEq(escrow.totalClaimable(), 0);
    }

    function testOpenBuyerAssignedOnFirstFunding() public {
        _createDefaultTrade(TRADE_ID, address(0));

        vm.prank(otherBuyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        ISafeDealEscrow.Trade memory t = escrow.getTrade(TRADE_ID);
        assertEq(t.buyer, otherBuyer);
        assertEq(uint8(t.status), uint8(ISafeDealEscrow.TradeStatus.FUNDED));
    }

    function testCancelUnfundedTradeBySeller() public {
        _createDefaultTrade(TRADE_ID, buyer);

        vm.prank(seller);
        escrow.cancelUnfundedTrade(TRADE_ID);

        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.CANCELLED));

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InvalidState.selector,
                ISafeDealEscrow.TradeStatus.CANCELLED,
                ISafeDealEscrow.TradeStatus.CREATED
            )
        );
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);
    }

    function testVoluntaryRefundBySeller() public {
        _createDefaultTrade(TRADE_ID, buyer);
        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        vm.prank(seller);
        escrow.refundBySeller(TRADE_ID);

        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.REFUNDED));
        assertEq(escrow.claimableBalances(buyer), AMOUNT);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(buyer.balance, before + AMOUNT);
    }

    function testRefundAfterDeliveryDeadlineOnlyWhenNotDelivered() public {
        (, uint64 deliveryDeadline) = _createDefaultTrade(TRADE_ID, buyer);
        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        // Exactly at deliveryDeadline still reverts (must be strictly > deliveryDeadline)
        vm.warp(deliveryDeadline);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.DeliveryDeadlineNotReached.selector,
                deliveryDeadline,
                uint64(block.timestamp)
            )
        );
        escrow.refundAfterDeadline(TRADE_ID);

        // After deliveryDeadline succeeds
        vm.warp(deliveryDeadline + 1);
        vm.prank(buyer);
        escrow.refundAfterDeadline(TRADE_ID);

        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.REFUNDED));
        assertEq(escrow.claimableBalances(buyer), AMOUNT);
    }

    function testRefundAfterDeadlineBlockedOnceDelivered() public {
        (, uint64 deliveryDeadline) = _createDefaultTrade(TRADE_ID, buyer);
        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        vm.prank(seller);
        escrow.markDelivered(TRADE_ID);

        vm.warp(deliveryDeadline + 10);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InvalidState.selector,
                ISafeDealEscrow.TradeStatus.DELIVERED,
                ISafeDealEscrow.TradeStatus.FUNDED
            )
        );
        escrow.refundAfterDeadline(TRADE_ID);
    }

    function testDisputeFromDeliveredSellerWaitsInspectionWindow() public {
        _createDefaultTrade(TRADE_ID, buyer);
        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        vm.prank(seller);
        escrow.markDelivered(TRADE_ID);
        uint64 deliveredAt = escrow.getTrade(TRADE_ID).deliveredAt;
        uint64 unlocksAt = deliveredAt + INSPECTION_WINDOW;

        // Seller cannot dispute during inspection window
        vm.warp(unlocksAt);
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.InspectionWindowActive.selector,
                unlocksAt,
                uint64(block.timestamp)
            )
        );
        escrow.openDispute(TRADE_ID);

        // Seller can initiate dispute once inspection window expires
        vm.warp(unlocksAt + 1);
        vm.prank(seller);
        escrow.openDispute(TRADE_ID);
        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.DISPUTED));

        // Arbiter splits 25% buyer / 75% seller
        uint256 buyerShare = 0.5 ether;
        uint256 sellerShare = 1.5 ether;
        vm.prank(arbiter);
        escrow.resolveDispute(TRADE_ID, buyerShare, sellerShare);

        assertEq(uint8(escrow.getTrade(TRADE_ID).status), uint8(ISafeDealEscrow.TradeStatus.RESOLVED));
        assertEq(escrow.claimableBalances(buyer), buyerShare);
        assertEq(escrow.claimableBalances(seller), sellerShare);
        assertEq(escrow.claimableBalances(arbiter), 0);
    }

    function testRejectsInvalidCreationParametersAndDuplicateIds() public {
        uint64 fundingDeadline = uint64(block.timestamp + 1 days);
        uint64 deliveryDeadline = uint64(block.timestamp + 7 days);

        vm.startPrank(seller);
        vm.expectRevert(SafeDealEscrow.InvalidTradeId.selector);
        escrow.createTrade(bytes32(0), buyer, arbiter, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.InvalidRoleSeparation.selector, "buyer-equals-seller"));
        escrow.createTrade(TRADE_ID, seller, arbiter, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.InvalidRoleSeparation.selector, "arbiter-equals-seller"));
        escrow.createTrade(TRADE_ID, buyer, seller, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.InvalidRoleSeparation.selector, "buyer-equals-arbiter"));
        escrow.createTrade(TRADE_ID, arbiter, arbiter, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(SafeDealEscrow.InvalidAmount.selector);
        escrow.createTrade(TRADE_ID, buyer, arbiter, 0, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(SafeDealEscrow.InvalidTermsHash.selector);
        escrow.createTrade(TRADE_ID, buyer, arbiter, AMOUNT, bytes32(0), fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        escrow.createTrade(TRADE_ID, buyer, arbiter, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);

        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.TradeAlreadyExists.selector, TRADE_ID));
        escrow.createTrade(TRADE_ID, buyer, arbiter, AMOUNT, TERMS_HASH, fundingDeadline, deliveryDeadline, INSPECTION_WINDOW);
        vm.stopPrank();
    }

    function testRejectsIncorrectFundingAmountAndExpiredFundingDeadline() public {
        (uint64 fundingDeadline,) = _createDefaultTrade(TRADE_ID, buyer);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.IncorrectPaymentAmount.selector, AMOUNT, 1 ether));
        escrow.fundTrade{value: 1 ether}(TRADE_ID);

        vm.warp(fundingDeadline + 1);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                SafeDealEscrow.FundingDeadlinePassed.selector,
                fundingDeadline,
                uint64(block.timestamp)
            )
        );
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);
    }

    function testRejectsUnauthorizedCallsAcrossLifecycle() public {
        _createDefaultTrade(TRADE_ID, buyer);

        // Wrong buyer cannot fund preassigned deal
        vm.prank(otherBuyer);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.UnauthorizedCaller.selector, otherBuyer));
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        // Seller or arbiter cannot fund open-buyer deal
        _createDefaultTrade(TRADE_ID_2, address(0));
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.InvalidRoleSeparation.selector, "buyer-equals-seller"));
        escrow.fundTrade{value: AMOUNT}(TRADE_ID_2);

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.InvalidRoleSeparation.selector, "buyer-equals-arbiter"));
        escrow.fundTrade{value: AMOUNT}(TRADE_ID_2);

        // Fund trade 1
        vm.prank(buyer);
        escrow.fundTrade{value: AMOUNT}(TRADE_ID);

        // Buyer cannot markDelivered
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.UnauthorizedCaller.selector, buyer));
        escrow.markDelivered(TRADE_ID);

        // Outsider cannot open dispute
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(SafeDealEscrow.UnauthorizedCaller.selector, outsider));
        escrow.openDispute(TRADE_ID);
    }
}
