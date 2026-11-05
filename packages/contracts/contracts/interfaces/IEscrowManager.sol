// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IEscrowManager {
    enum EscrowStatus {
        NONE,
        CREATED,
        FUNDED,
        RELEASED,
        REFUNDED,
        DISPUTED
    }

    event EscrowCreated(bytes32 indexed dealId, address indexed buyer, address indexed seller, address token, uint256 amount);
    event EscrowFunded(bytes32 indexed dealId, address indexed buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed dealId, address indexed beneficiary, uint256 amount);
    event EscrowRefunded(bytes32 indexed dealId, address indexed buyer, uint256 amount);
    event EscrowDisputed(bytes32 indexed dealId, address indexed raisedBy);
    event EscrowResolved(bytes32 indexed dealId, address indexed beneficiary, uint256 amount, bool refund);
    event IntegrityGuardUpdated(address indexed guard);

    function createEscrow(bytes32 dealId, address seller, address token, uint256 amount) external;
    function fundEscrow(bytes32 dealId) external;
    function releaseEscrow(bytes32 dealId) external;
    function refundEscrow(bytes32 dealId) external;
    function markDisputed(bytes32 dealId) external;
    function resolveDispute(bytes32 dealId, bool refundBuyer) external;
    function statusOf(bytes32 dealId) external view returns (EscrowStatus);
}
