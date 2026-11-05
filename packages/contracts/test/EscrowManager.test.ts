import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { ONE_USD, ZERO_ADDRESS, bytes32 } from "./helpers.js";

const { viem } = await network.connect();
const DEAL = bytes32("11");

async function setup(guard: `0x${string}` = ZERO_ADDRESS) {
  const [admin, buyer, seller, outsider] = await viem.getWalletClients();
  const token = await viem.deployContract("MockPaymentToken");
  const escrow = await viem.deployContract("EscrowManager", [admin.account.address, guard]);
  await token.write.mint([buyer.account.address, ONE_USD]);
  return { admin, buyer, seller, outsider, token, escrow };
}

async function fund({ buyer, seller, token, escrow }: Awaited<ReturnType<typeof setup>>) {
  await escrow.write.createEscrow([DEAL, seller.account.address, token.address, ONE_USD], { account: buyer.account });
  await token.write.approve([escrow.address, ONE_USD], { account: buyer.account });
  await escrow.write.fundEscrow([DEAL], { account: buyer.account });
}

describe("EscrowManager", () => {
  it("rejects an escrow where buyer and seller are the same wallet", async () => {
    const ctx = await setup();
    await viem.assertions.revertWithCustomError(
      ctx.escrow.write.createEscrow([DEAL, ctx.buyer.account.address, ctx.token.address, ONE_USD], {
        account: ctx.buyer.account,
      }),
      ctx.escrow,
      "InvalidArgument",
    );
  });

  it("moves tokens into custody and reports FUNDED", async () => {
    const ctx = await setup();
    await fund(ctx);
    assert.equal(await ctx.escrow.read.statusOf([DEAL]), 2); // EscrowStatus.FUNDED
    assert.equal(await ctx.token.read.balanceOf([ctx.escrow.address]), ONE_USD);
  });

  it("does not let an outsider release funds", async () => {
    const ctx = await setup();
    await fund(ctx);
    await viem.assertions.revertWithCustomError(
      ctx.escrow.write.releaseEscrow([DEAL], { account: ctx.outsider.account }),
      ctx.escrow,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("lets the release role pay the seller", async () => {
    const ctx = await setup();
    await fund(ctx);
    await ctx.escrow.write.releaseEscrow([DEAL], { account: ctx.admin.account });
    assert.equal(await ctx.token.read.balanceOf([ctx.seller.account.address]), ONE_USD);
    assert.equal(await ctx.escrow.read.statusOf([DEAL]), 3); // EscrowStatus.RELEASED
  });

  it("refuses release when the integrity guard denies it", async () => {
    const guard = await viem.deployContract("RejectingGuard");
    const ctx = await setup(guard.address);
    await fund(ctx);
    await assert.rejects(
      ctx.escrow.write.releaseEscrow([DEAL], { account: ctx.admin.account }),
      /integrity-guard:/,
    );
    assert.equal(await ctx.escrow.read.statusOf([DEAL]), 2); // still FUNDED
  });
});
