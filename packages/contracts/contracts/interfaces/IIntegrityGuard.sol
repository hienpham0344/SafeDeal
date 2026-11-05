// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IIntegrityGuard
 * @notice Optional safety check executed at fund-release time even if the off-chain AI service
 *         has already approved a deal. Implementations MUST NOT transfer or approve funds; they
 *         only answer yes/no. Keeping this hook on-chain guarantees that an AI service (compromised
 *         or buggy) can never unilaterally cause a payout.
 */
interface IIntegrityGuard {
    /**
     * @return allowed true when the release may proceed.
     * @return reason machine-readable rejection code (for events / debugging).
     */
    function allowRelease(bytes32 dealId, address beneficiary, uint256 amount)
        external
        view
        returns (bool allowed, bytes32 reason);
}
