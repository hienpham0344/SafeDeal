// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockPaymentToken
 * @notice Test-only stablecoin-like token for Avalanche Fuji. Anyone can mint, so it must never be
 *         used somewhere real funds are involved.
 */
contract MockPaymentToken is ERC20 {
    constructor() ERC20("SafeDeal Mock USD", "sdmUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
