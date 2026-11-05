// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDisputeResolver} from "../interfaces/IDisputeResolver.sol";

/**
 * @title DisputeResolver
 * @notice Records dispute cases and arbiter rulings. It intentionally does not move funds;
 *         the backend reads the ruling (DisputeRuled event) and asks EscrowManager to execute it.
 *         Separating recording from custody keeps the arbiter role free of token approvals.
 */
contract DisputeResolver is IDisputeResolver, AccessControl {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    struct Dispute {
        bytes32 dealId;
        address raisedBy;
        bool ruled;
        bool refundBuyer;
    }

    mapping(bytes32 => Dispute) private _disputes;

    event EvidenceSubmitted(bytes32 indexed disputeId, address indexed submitter, string evidenceHash);

    error DisputeAlreadyExists(bytes32 disputeId);
    error DisputeNotFound(bytes32 disputeId);
    error AlreadyRuled(bytes32 disputeId);
    error NotCaseParticipant(bytes32 disputeId);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);
    }

    function openDispute(bytes32 disputeId, bytes32 dealId, string calldata evidenceHash) external {
        if (_disputes[disputeId].raisedBy != address(0)) revert DisputeAlreadyExists(disputeId);
        _disputes[disputeId] = Dispute({dealId: dealId, raisedBy: msg.sender, ruled: false, refundBuyer: false});
        emit DisputeOpened(disputeId, dealId, msg.sender, evidenceHash);
    }

    function submitEvidence(bytes32 disputeId, string calldata evidenceHash) external {
        Dispute storage d = _disputes[disputeId];
        if (d.raisedBy == address(0)) revert DisputeNotFound(disputeId);
        if (d.raisedBy != msg.sender) revert NotCaseParticipant(disputeId);
        emit EvidenceSubmitted(disputeId, msg.sender, evidenceHash);
    }

    function rule(bytes32 disputeId, bool refundBuyer, string calldata reasonHash) external onlyRole(ARBITER_ROLE) {
        Dispute storage d = _disputes[disputeId];
        if (d.raisedBy == address(0)) revert DisputeNotFound(disputeId);
        if (d.ruled) revert AlreadyRuled(disputeId);
        d.ruled = true;
        d.refundBuyer = refundBuyer;
        emit DisputeRuled(disputeId, refundBuyer, reasonHash);
    }

    function isRuled(bytes32 disputeId) external view returns (bool) {
        return _disputes[disputeId].ruled;
    }

    function rulingOf(bytes32 disputeId) external view returns (bool refundBuyer) {
        return _disputes[disputeId].refundBuyer;
    }
}
