import type { HardhatUserConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";

const fujiRpcUrl = process.env.AVALANCHE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
// Never commit a private key. Export it in your shell before deploying; omit it to compile/test only.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const fujiAccounts: `0x${string}`[] = deployerKey ? [deployerKey as `0x${string}`] : [];

const config: HardhatUserConfig = {
  plugins: [hardhatViem, hardhatViemAssertions, hardhatNodeTestRunner, hardhatIgnitionViem],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1" },
    fuji: {
      type: "http",
      url: fujiRpcUrl,
      chainId: 43113,
      accounts: fujiAccounts,
    },
  },
  paths: { sources: "./contracts", tests: "./test", artifacts: "./artifacts", cache: "./cache" },
};

export default config;
