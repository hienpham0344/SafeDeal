// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISafeDealEscrow {
    enum TradeStatus {
        NONE,
        CREATED,
        FUNDED,
        DELIVERED,
        RELEASED,
        REFUNDED,
        DISPUTED,
        RESOLVED,
        CANCELLED
    }

    struct Trade {
        bytes32 tradeId;
        address seller;
        address buyer;
        address arbiter;
        uint256 amount;
        bytes32 termsHash;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 deliveredAt;
        uint64 fundingDeadline;
        uint64 deliveryDeadline;
        uint64 inspectionWindow;
        TradeStatus status;
        bool settled;
    }

    event TradeCreated(
        bytes32 indexed tradeId,
        address indexed seller,
        address indexed buyer,
        address arbiter,
        uint256 amount,
        bytes32 termsHash,
        uint64 fundingDeadline,
        uint64 deliveryDeadline,
        uint64 inspectionWindow
    );

    event TradeFunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount);
    event DeliveryMarked(bytes32 indexed tradeId, address indexed seller, uint64 deliveredAt);
    event FundsReleased(bytes32 indexed tradeId, address indexed seller, uint256 amount);
    event RefundExecuted(
        bytes32 indexed tradeId,
        address indexed buyer,
        uint256 amount,
        address indexed initiatedBy
    );
    event DisputeOpened(bytes32 indexed tradeId, address indexed openedBy);
    event DisputeResolved(
        bytes32 indexed tradeId,
        address indexed arbiter,
        address indexed buyer,
        uint256 buyerAmount,
        address seller,
        uint256 sellerAmount
    );
    event FundsWithdrawn(address indexed beneficiary, uint256 amount);
    event TradeCancelled(bytes32 indexed tradeId, address indexed cancelledBy);

    function createTrade(
        bytes32 tradeId,
        address preassignedBuyer,
        address arbiter,
        uint256 amount,
        bytes32 termsHash,
        uint64 fundingDeadline,
        uint64 deliveryDeadline,
        uint64 inspectionWindow
    ) external;

    function fundTrade(bytes32 tradeId) external payable;
    function markDelivered(bytes32 tradeId) external;
    function releaseFunds(bytes32 tradeId) external;
    function refundBySeller(bytes32 tradeId) external;
    function refundAfterDeadline(bytes32 tradeId) external;
    function openDispute(bytes32 tradeId) external;
    function resolveDispute(bytes32 tradeId, uint256 buyerAmount, uint256 sellerAmount) external;
    function cancelUnfundedTrade(bytes32 tradeId) external;
    function withdraw() external;

    function getTrade(bytes32 tradeId) external view returns (Trade memory);
    function claimableBalances(address account) external view returns (uint256);
    function totalLockedEscrow() external view returns (uint256);
    function totalClaimable() external view returns (uint256);
}
