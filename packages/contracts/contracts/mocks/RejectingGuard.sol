// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IIntegrityGuard} from "../interfaces/IIntegrityGuard.sol";

/** @notice Test helper: simulates an on-chain guard rejecting a fund release. */
contract RejectingGuard is IIntegrityGuard {
    function allowRelease(bytes32, address, uint256) external pure returns (bool, bytes32) {
        return (false, keccak256("guard-rejected"));
    }
}
