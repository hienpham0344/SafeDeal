// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIntegrityGuard} from "../interfaces/IIntegrityGuard.sol";
import {IEscrowManager} from "../interfaces/IEscrowManager.sol";

/**
 * @title DeployerGuard
 * @notice Bootstrap integrity guard: allows releases only while the escrow is FUNDED and the
 *         caller is not the seller themselves (EscrowManager already enforces the latter).
 *
 * It exists so the platform can deploy without an AI/risk provider. Risk-engine guards (e.g.
 * warranty-expired checks, AI risk score thresholds) implement the same interface and are swapped
 * through EscrowManager.setIntegrityGuard. The guard is a veto only, never a payment path.
 */
contract DeployerGuard is IIntegrityGuard, AccessControl {
    bytes32 public constant GUARD_ADMIN_ROLE = keccak256("GUARD_ADMIN_ROLE");

    address public escrowManager;
    bool public frozen;

    event GuardFrozen(bool frozen);
    event EscrowManagerUpdated(address indexed escrowManager);

    error NotEscrowManager(address caller);

    constructor(address admin, address escrowManager_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARD_ADMIN_ROLE, admin);
        escrowManager = escrowManager_;
        emit EscrowManagerUpdated(escrowManager_);
    }

    function allowRelease(bytes32 dealId, address, uint256) external view returns (bool, bytes32) {
        if (frozen) return (false, "guard-frozen");
        if (escrowManager != address(0) && msg.sender != escrowManager) return (false, "untrusted-caller");
        IEscrowManager.EscrowStatus status = IEscrowManager(escrowManager).statusOf(dealId);
        if (status != IEscrowManager.EscrowStatus.FUNDED) return (false, "escrow-not-funded");
        return (true, bytes32(0));
    }

    function setFrozen(bool value) external onlyRole(GUARD_ADMIN_ROLE) {
        frozen = value;
        emit GuardFrozen(value);
    }

    function setEscrowManager(address value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        escrowManager = value;
        emit EscrowManagerUpdated(value);
    }
}
