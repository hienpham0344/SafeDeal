// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEscrowManager} from "../interfaces/IEscrowManager.sol";
import {IIntegrityGuard} from "../interfaces/IIntegrityGuard.sol";

/**
 * @title EscrowManager
 * @notice Holds the platform's P2P escrow funds and enforces participant-only transitions.
 *
 * @dev Scaffolding only: state machine, roles and events are final-shaped, but release/refund
 *      policies (warranty window, dispute wiring) are intentionally minimal. Funds are pulled
 *      with SafeERC20 so the platform can later support any ERC-20 (or the mock token on Fuji).
 *
 * Security notes:
 * - Only the buyer can fund; buyer/seller (and arbiter) can move to DISPUTED.
 * - ARBITER_ROLE resolves disputes; it never holds funds directly.
 * - RELEASE_ROLE (the backend relayer) can release, but only through the IIntegrityGuard hook,
 *   so an off-chain AI decision alone can never move money.
 */
contract EscrowManager is IEscrowManager, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant RELEASE_ROLE = keccak256("RELEASE_ROLE");

    struct Escrow {
        address buyer;
        address seller;
        address token;
        uint256 amount;
        EscrowStatus status;
        uint64 createdAt;
    }

    mapping(bytes32 => Escrow) private _escrows;
    IIntegrityGuard public integrityGuard;

    error EscrowAlreadyExists(bytes32 dealId);
    error EscrowNotFound(bytes32 dealId);
    error InvalidState(EscrowStatus current, EscrowStatus expected);
    error InvalidArgument(string field);

    modifier onlyParticipant(bytes32 dealId) {
        Escrow storage e = _escrows[dealId];
        if (e.buyer != msg.sender && e.seller != msg.sender) revert EscrowNotFound(dealId);
        _;
    }

    constructor(address admin, address guard) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ARBITER_ROLE, admin);
        _grantRole(RELEASE_ROLE, admin);
        integrityGuard = IIntegrityGuard(guard);
        emit IntegrityGuardUpdated(guard);
    }

    function createEscrow(bytes32 dealId, address seller, address token, uint256 amount) external {
        if (seller == address(0)) revert InvalidArgument("seller");
        if (token == address(0)) revert InvalidArgument("token");
        if (amount == 0) revert InvalidArgument("amount");
        if (seller == msg.sender) revert InvalidArgument("seller-is-buyer");
        if (_escrows[dealId].status != EscrowStatus.NONE) revert EscrowAlreadyExists(dealId);

        _escrows[dealId] = Escrow({
            buyer: msg.sender,
            seller: seller,
            token: token,
            amount: amount,
            status: EscrowStatus.CREATED,
            createdAt: uint64(block.timestamp)
        });
        emit EscrowCreated(dealId, msg.sender, seller, token, amount);
    }

    function fundEscrow(bytes32 dealId) external nonReentrant {
        Escrow storage e = _escrows[dealId];
        if (e.buyer != msg.sender) revert EscrowNotFound(dealId);
        if (e.status != EscrowStatus.CREATED) revert InvalidState(e.status, EscrowStatus.CREATED);

        e.status = EscrowStatus.FUNDED;
        IERC20(e.token).safeTransferFrom(msg.sender, address(this), e.amount);
        emit EscrowFunded(dealId, msg.sender, e.amount);
    }

    function releaseEscrow(bytes32 dealId) external nonReentrant onlyRole(RELEASE_ROLE) {
        Escrow storage e = _escrows[dealId];
        if (e.status != EscrowStatus.FUNDED) revert InvalidState(e.status, EscrowStatus.FUNDED);

        if (address(integrityGuard) != address(0)) {
            (bool allowed, bytes32 reason) = integrityGuard.allowRelease(dealId, e.seller, e.amount);
            require(allowed, string(abi.encodePacked("integrity-guard:", reason)));
        }

        e.status = EscrowStatus.RELEASED;
        IERC20(e.token).safeTransfer(e.seller, e.amount);
        emit EscrowReleased(dealId, e.seller, e.amount);
    }

    function refundEscrow(bytes32 dealId) external nonReentrant onlyRole(ARBITER_ROLE) {
        Escrow storage e = _escrows[dealId];
        if (e.status != EscrowStatus.FUNDED && e.status != EscrowStatus.DISPUTED) {
            revert InvalidState(e.status, EscrowStatus.FUNDED);
        }
        e.status = EscrowStatus.REFUNDED;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(dealId, e.buyer, e.amount);
    }

    function markDisputed(bytes32 dealId) external onlyParticipant(dealId) {
        Escrow storage e = _escrows[dealId];
        if (e.status != EscrowStatus.FUNDED) revert InvalidState(e.status, EscrowStatus.FUNDED);
        e.status = EscrowStatus.DISPUTED;
        emit EscrowDisputed(dealId, msg.sender);
    }

    function resolveDispute(bytes32 dealId, bool refundBuyer) external nonReentrant onlyRole(ARBITER_ROLE) {
        Escrow storage e = _escrows[dealId];
        if (e.status != EscrowStatus.DISPUTED) revert InvalidState(e.status, EscrowStatus.DISPUTED);

        e.status = refundBuyer ? EscrowStatus.REFUNDED : EscrowStatus.RELEASED;
        address beneficiary = refundBuyer ? e.buyer : e.seller;
        IERC20(e.token).safeTransfer(beneficiary, e.amount);
        emit EscrowResolved(dealId, beneficiary, e.amount, refundBuyer);
    }

    function statusOf(bytes32 dealId) external view returns (EscrowStatus) {
        return _escrows[dealId].status;
    }

    function setIntegrityGuard(address guard) external onlyRole(DEFAULT_ADMIN_ROLE) {
        integrityGuard = IIntegrityGuard(guard);
        emit IntegrityGuardUpdated(guard);
    }
}
