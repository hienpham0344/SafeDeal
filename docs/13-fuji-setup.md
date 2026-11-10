# Avalanche Fuji C-Chain Setup (Setup Steps 9–13)

This guide covers Setup **Steps 9–13** for deploying [`SafeDealEscrow.sol`](../blockchain/src/SafeDealEscrow.sol) to Avalanche Fuji Testnet (`chainId = 43113`). Continue to [`14-railway-setup.md`](./14-railway-setup.md) (Steps 14–19) once deployed.

---

### Step 9: Configure Testnet Deployer Wallet & Fund Testnet AVAX

Generate or designate a **testnet-only** EVM wallet (never reuse a mainnet private key). Obtain Fuji test AVAX from an Avalanche Fuji faucet so the deployer wallet can pay deployment gas.

Verify balance and live Fuji RPC responsiveness (`chainId == 43113`):

```bash
export FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
cast chain-id --rpc-url "$FUJI_RPC_URL"
cast balance <YOUR_TESTNET_DEPLOYER_ADDRESS> --ether --rpc-url "$FUJI_RPC_URL"
```

---

### Step 10: Run Pre-Deployment Smart Contract Verification

Confirm all unit, security attack, and stateful solvency invariant suites pass locally before broadcasting:

```bash
forge test --root blockchain -vvv
```

---

### Step 11: Deploy `SafeDealEscrow` to Avalanche Fuji

Export `DEPLOYER_PRIVATE_KEY` (and optionally `SNOWTRACE_API_KEY` for automatic source verification) in your shell session only:

```bash
export FUJI_RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
export DEPLOYER_PRIVATE_KEY="<TESTNET_ONLY_PRIVATE_KEY>"
export SNOWTRACE_API_KEY="<OPTIONAL_SNOWTRACE_API_KEY>" # omit if skipping automated explorer verification

bash scripts/deploy-fuji.sh
```

> Alternatively, trigger the manual GitHub Actions workflow `.github/workflows/contracts-deploy.yml` with repository secret `DEPLOYER_PRIVATE_KEY` configured under the `testnet` environment.

---

### Step 12: Record Canonical Deployment Metadata (No Fabricated Values)

Inspect the broadcast receipt under gitignored `blockchain/broadcast/Deploy.s.sol/43113/run-latest.json` (or Snowtrace testnet explorer) and record exact verified metadata for your backend and frontend configurations:

- **Contract Address (`ESCROW_CONTRACT_ADDRESS` / `VITE_ESCROW_CONTRACT_ADDRESS`)**: `<DEPLOYED_FUJI_ADDRESS>`
- **Deployment Block (`ESCROW_DEPLOYMENT_BLOCK`)**: `<DEPLOYMENT_BLOCK>`
- **Transaction Hash**: `<FUJI_DEPLOY_TX_HASH>`
- **Explorer Link**: `https://testnet.snowtrace.io/address/<DEPLOYED_FUJI_ADDRESS>`

---

### Step 13: Verify Live Deployed Bytecode & Initial State on Fuji

Confirm non-empty bytecode and initial zero escrow accounting directly against Fuji C-Chain via `cast`:

```bash
cast code <DEPLOYED_FUJI_ADDRESS> --rpc-url "$FUJI_RPC_URL"
cast call <DEPLOYED_FUJI_ADDRESS> "totalLockedEscrow()(uint256)" --rpc-url "$FUJI_RPC_URL"
cast call <DEPLOYED_FUJI_ADDRESS> "totalClaimable()(uint256)" --rpc-url "$FUJI_RPC_URL"
```

Expected: non-empty contract bytecode (`0x6080...`) and both counters equal to `0`.
