// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISubscriptionManager} from "../interfaces/ISubscriptionManager.sol";

/**
 * @title SubscriptionManager
 * @notice On-chain Premium subscriptions. The backend treats a user as Premium only after it has
 *         verified the corresponding SubscriptionStarted event on-chain.
 */
contract SubscriptionManager is ISubscriptionManager, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    mapping(address => uint64) private _expiresAt;
    address public treasury;

    event TreasuryUpdated(address indexed treasury);

    constructor(address admin, address treasury_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function startSubscription(address subscriber, address token, uint256 amount, uint64 periodSeconds)
        external
        onlyRole(SETTLER_ROLE)
    {
        uint64 start = _expiresAt[subscriber] > block.timestamp ? _expiresAt[subscriber] : uint64(block.timestamp);
        uint64 end = start + periodSeconds;
        _expiresAt[subscriber] = end;
        IERC20(token).safeTransferFrom(msg.sender, treasury, amount);
        emit SubscriptionStarted(subscriber, token, amount, start, end);
    }

    function cancel(address subscriber) external {
        require(_isActive(subscriber), "not active");
        _expiresAt[subscriber] = uint64(block.timestamp);
        emit SubscriptionCancelled(subscriber);
    }

    function isActive(address subscriber) external view returns (bool) {
        return _isActive(subscriber);
    }

    function expiresAt(address subscriber) external view returns (uint64) {
        return _expiresAt[subscriber];
    }

    function _isActive(address subscriber) internal view returns (bool) {
        return _expiresAt[subscriber] > block.timestamp;
    }
}
