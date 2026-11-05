import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys the SafeDeal contract set to Avalanche Fuji (or a local node).
 *
 * Deployer wallet receives DEFAULT_ADMIN_ROLE and initial arbiter/settler roles. Move arbiter
 * rights to the arbitration wallet before handling real deals. The backend reads addresses from
 * environment variables (ESCROW_MANAGER_ADDRESS, ...), never from hardcoded source values.
 */
export default buildModule("SafeDealModule", (m) => {
  const deployer = m.getAccount(0);

  const paymentToken = m.contract("MockPaymentToken");
  const disputeResolver = m.contract("DisputeResolver", [deployer]);
  const escrowManager = m.contract("EscrowManager", [deployer, "0x0000000000000000000000000000000000000000"]);
  const subscriptionManager = m.contract("SubscriptionManager", [deployer, deployer]);
  const guard = m.contract("DeployerGuard", [deployer, escrowManager]);

  m.call(escrowManager, "setIntegrityGuard", [guard]);

  return { paymentToken, disputeResolver, escrowManager, subscriptionManager, guard };
});
