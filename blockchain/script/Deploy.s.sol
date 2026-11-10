// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SafeDealEscrow} from "../src/SafeDealEscrow.sol";

contract Deploy is Script {
    function run() external returns (SafeDealEscrow escrow) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        escrow = new SafeDealEscrow();
        vm.stopBroadcast();

        console2.log("SafeDealEscrow deployed at:", address(escrow));
        console2.log("Chain ID:", block.chainid);
    }
}
