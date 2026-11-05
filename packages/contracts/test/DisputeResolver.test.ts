import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { bytes32 } from "./helpers.js";

const { viem } = await network.connect();

describe("DisputeResolver", () => {
  it("lets only an arbiter rule, and only once", async () => {
    const [admin, outsider] = await viem.getWalletClients();
    const resolver = await viem.deployContract("DisputeResolver", [admin.account.address]);
    const disputeId = bytes32("22");

    await resolver.write.openDispute([disputeId, bytes32("33"), "ipfs://evidence"], { account: admin.account });

    await viem.assertions.revertWithCustomError(
      resolver.write.rule([disputeId, true, "reason"], { account: outsider.account }),
      resolver,
      "AccessControlUnauthorizedAccount",
    );

    await resolver.write.rule([disputeId, true, "reason"], { account: admin.account });
    assert.equal(await resolver.read.isRuled([disputeId]), true);

    await viem.assertions.revertWithCustomError(
      resolver.write.rule([disputeId, false, "again"], { account: admin.account }),
      resolver,
      "AlreadyRuled",
    );
  });

  it("rejects evidence from a wallet that is not a case participant", async () => {
    const [admin, outsider] = await viem.getWalletClients();
    const resolver = await viem.deployContract("DisputeResolver", [admin.account.address]);
    const disputeId = bytes32("44");

    await resolver.write.openDispute([disputeId, bytes32("55"), "ipfs://e"], { account: admin.account });
    await viem.assertions.revertWithCustomError(
      resolver.write.submitEvidence([disputeId, "ipfs://x"], { account: outsider.account }),
      resolver,
      "NotCaseParticipant",
    );
  });
});
