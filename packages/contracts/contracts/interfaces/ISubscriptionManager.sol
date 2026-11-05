// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISubscriptionManager {
    event SubscriptionStarted(address indexed subscriber, address token, uint256 amount, uint64 start, uint64 end);
    event SubscriptionCancelled(address indexed subscriber);

    function startSubscription(address subscriber, address token, uint256 amount, uint64 periodSeconds) external;
    function isActive(address subscriber) external view returns (bool);
    function expiresAt(address subscriber) external view returns (uint64);
}
