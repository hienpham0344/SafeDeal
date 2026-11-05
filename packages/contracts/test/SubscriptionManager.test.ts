import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { viem } = await network.connect();

describe("SubscriptionManager", () => {
  it("activates a subscription and forwards payment to the treasury", async () => {
    const [admin, subscriber, treasury] = await viem.getWalletClients();
    const token = await viem.deployContract("MockPaymentToken");
    const subs = await viem.deployContract("SubscriptionManager", [admin.account.address, treasury.account.address]);

    await token.write.mint([admin.account.address, 5_000_000n]);
    await token.write.approve([subs.address, 5_000_000n], { account: admin.account });

    assert.equal(await subs.read.isActive([subscriber.account.address]), false);
    await subs.write.startSubscription([subscriber.account.address, token.address, 5_000_000n, 30n * 24n * 3600n], {
      account: admin.account,
    });

    assert.equal(await subs.read.isActive([subscriber.account.address]), true);
    assert.equal(await token.read.balanceOf([treasury.account.address]), 5_000_000n);
  });

  it("only lets the settler role start subscriptions", async () => {
    const [, outsider] = await viem.getWalletClients();
    const token = await viem.deployContract("MockPaymentToken");
    const subs = await viem.deployContract("SubscriptionManager", [outsider.account.address, outsider.account.address]);
    const [, , stranger] = await viem.getWalletClients();

    await viem.assertions.revertWithCustomError(
      subs.write.startSubscription([stranger.account.address, token.address, 1n, 60n], { account: stranger.account }),
      subs,
      "AccessControlUnauthorizedAccount",
    );
  });
});
