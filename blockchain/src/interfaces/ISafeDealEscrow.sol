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
        uint64 createdAt;
        TradeStatus status;
        bool settled;
        address buyer;
        uint64 fundedAt;
        address arbiter;
        uint64 fundingDeadline;
        uint256 amount;
        bytes32 termsHash;
        uint64 deliveredAt;
        uint64 deliveryDeadline;
        uint64 inspectionWindow;
        uint64 disputedAt;
    }

    struct DisputeVoteSummary {
        bytes32 buyerVoteHash;
        bytes32 sellerVoteHash;
        bytes32 arbiterVoteHash;
        uint64 disputedAt;
        uint64 timeoutAt;
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
    event DisputeOpened(bytes32 indexed tradeId, address indexed openedBy, uint64 disputedAt);
    event DisputeVoteSubmitted(
        bytes32 indexed tradeId,
        address indexed voter,
        uint256 buyerAmount,
        uint256 sellerAmount,
        bytes32 proposalHash,
        uint8 matchCount
    );
    event DisputeResolved(
        bytes32 indexed tradeId,
        address indexed settledBy,
        address indexed buyer,
        uint256 buyerAmount,
        address seller,
        uint256 sellerAmount
    );
    event DisputeResolvedByTimeout(
        bytes32 indexed tradeId,
        address indexed triggeredBy,
        uint256 buyerAmount,
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
    function submitResolutionVote(bytes32 tradeId, uint256 buyerAmount, uint256 sellerAmount) external;
    function resolveDisputeByTimeout(bytes32 tradeId) external;
    function cancelUnfundedTrade(bytes32 tradeId) external;
    function withdraw() external;

    function DISPUTE_TIMEOUT() external view returns (uint64);
    function getTrade(bytes32 tradeId) external view returns (Trade memory);
    function getDisputeVotes(bytes32 tradeId) external view returns (DisputeVoteSummary memory);
    function claimableBalances(address account) external view returns (uint256);
    function totalLockedEscrow() external view returns (uint256);
    function totalClaimable() external view returns (uint256);
}
