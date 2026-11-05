// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDisputeResolver {
    event DisputeOpened(bytes32 indexed disputeId, bytes32 indexed dealId, address indexed raisedBy, string evidenceHash);
    event DisputeRuled(bytes32 indexed disputeId, bool refundBuyer, string reasonHash);

    function openDispute(bytes32 disputeId, bytes32 dealId, string calldata evidenceHash) external;
    function submitEvidence(bytes32 disputeId, string calldata evidenceHash) external;
    function rule(bytes32 disputeId, bool refundBuyer, string calldata reasonHash) external;
}
