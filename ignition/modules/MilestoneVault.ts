import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import { network } from "hardhat";

describe("MilestoneVault", async function () {
  const { viem } = await network.create();

  it("deploys with a valid arbitrator address", async function () {
    const [client, developer, arbitrator] =
      await viem.getWalletClients();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    assert.ok(vault.address);
  });

  it("allows the client to create a project with milestones", async function () {
    const [client, developer, arbitrator] =
      await viem.getWalletClients();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    const amounts = [parseEther("1"), parseEther("2")];

    await vault.write.createProject([
      developer.account.address,
      amounts,
    ]);

    const project = await vault.read.getProject([1n]);

    assert.equal(
      project[0].toLowerCase(),
      client.account.address.toLowerCase(),
    );
    assert.equal(
      project[1].toLowerCase(),
      developer.account.address.toLowerCase(),
    );
    assert.equal(project[2], parseEther("3"));
    assert.equal(project[4], 2n);
    assert.equal(project[5], false);
  });

  it("rejects funding with an incorrect amount", async function () {
    const [client, developer, arbitrator] =
      await viem.getWalletClients();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    await vault.write.createProject([
      developer.account.address,
      [parseEther("1")],
    ]);

    await assert.rejects(async () => {
      await vault.write.fundProject([1n], {
        value: parseEther("0.5"),
      });
    });
  });
});