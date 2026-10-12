import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { network } from "hardhat";

describe("MilestoneVault", async function () {
  const { viem, networkHelpers } = await network.create();

  const SAMPLE_EVIDENCE: Hex =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  const SAMPLE_EVIDENCE_2: Hex =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  // Enum MilestoneStatus mirror
  const MilestoneStatus = {
    Pending: 0,
    Submitted: 1,
    Disputed: 2,
    Released: 3,
    Refunded: 4,
  } as const;

  async function deployVaultFixture() {
    const [client, developer, arbitrator, stranger, other] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    return {
      vault,
      client,
      developer,
      arbitrator,
      stranger,
      other,
      publicClient,
    };
  }

  async function fundedProjectFixture() {
    const fixture = await deployVaultFixture();
    const { vault, client, developer } = fixture;

    const amounts = [parseEther("1"), parseEther("2")];
    await vault.write.createProject([developer.account.address, amounts], {
      account: client.account,
    });

    await vault.write.fundProject([1n], {
      account: client.account,
      value: parseEther("3"),
    });

    return { ...fixture, projectId: 1n, amounts };
  }

  async function submittedMilestoneFixture() {
    const fixture = await fundedProjectFixture();
    const { vault, developer, projectId } = fixture;

    await vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
      account: developer.account,
    });

    return fixture;
  }

  async function disputedMilestoneFixture() {
    const fixture = await submittedMilestoneFixture();
    const { vault, client, projectId } = fixture;

    await vault.write.disputeMilestone([projectId, 0n], {
      account: client.account,
    });

    return fixture;
  }

  // =========================================================================
  // Baseline Tests (Preserved from original suite)
  // =========================================================================
  it("deploys with a valid arbitrator address", async function () {
    const [, , arbitrator] = await viem.getWalletClients();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    assert.ok(vault.address);
  });

  it("allows the client to create a project with milestones", async function () {
    const [client, developer, arbitrator] = await viem.getWalletClients();

    const vault = await viem.deployContract("MilestoneVault", [
      arbitrator.account.address,
    ]);

    const amounts = [parseEther("1"), parseEther("2")];

    await vault.write.createProject([developer.account.address, amounts]);

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
    const [, developer, arbitrator] = await viem.getWalletClients();

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

  // =========================================================================
  // Deployment & Constructor Access Control
  // =========================================================================
  describe("Constructor & Initialization", function () {
    it("stores the immutable arbitrator address", async function () {
      const { vault, arbitrator } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      const storedArbitrator = await vault.read.arbitrator();
      assert.equal(
        storedArbitrator.toLowerCase(),
        arbitrator.account.address.toLowerCase(),
      );
    });

    it("initializes nextProjectId to 1", async function () {
      const { vault } = await networkHelpers.loadFixture(deployVaultFixture);
      const nextId = await vault.read.nextProjectId();
      assert.equal(nextId, 1n);
    });

    it("reverts deployment when arbitrator is the zero address", async function () {
      await viem.assertions.revertWith(
        viem.deployContract("MilestoneVault", [zeroAddress]),
        "Arbitrator is zero address",
      );
    });
  });

  // =========================================================================
  // Project Creation Validation & Access Control
  // =========================================================================
  describe("Project Creation (createProject)", function () {
    it("emits ProjectCreated event with accurate parameters", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      const amounts = [parseEther("0.5"), parseEther("1.5")];

      await viem.assertions.emitWithArgs(
        vault.write.createProject([developer.account.address, amounts], {
          account: client.account,
        }),
        vault,
        "ProjectCreated",
        [1n, client.account.address, developer.account.address, parseEther("2"), 2n],
      );
    });

    it("initializes milestone status to Pending and evidenceHash to 0", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      const amounts = [parseEther("1"), parseEther("2")];

      await vault.write.createProject([developer.account.address, amounts], {
        account: client.account,
      });

      const m0 = await vault.read.getMilestone([1n, 0n]);
      assert.equal(m0[0], parseEther("1"));
      assert.equal(m0[1], MilestoneStatus.Pending);
      assert.equal(m0[2], zeroHash);

      const m1 = await vault.read.getMilestone([1n, 1n]);
      assert.equal(m1[0], parseEther("2"));
      assert.equal(m1[1], MilestoneStatus.Pending);
      assert.equal(m1[2], zeroHash);
    });

    it("increments nextProjectId on sequential creations", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );

      await vault.write.createProject([developer.account.address, [parseEther("1")]], {
        account: client.account,
      });
      assert.equal(await vault.read.nextProjectId(), 2n);

      await vault.write.createProject([developer.account.address, [parseEther("2")]], {
        account: client.account,
      });
      assert.equal(await vault.read.nextProjectId(), 3n);
    });

    it("reverts if developer is address(0)", async function () {
      const { vault, client } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject([zeroAddress, [parseEther("1")]], {
          account: client.account,
        }),
        "Developer is zero address",
      );
    });

    it("reverts if client specifies themselves as developer", async function () {
      const { vault, client } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject([client.account.address, [parseEther("1")]], {
          account: client.account,
        }),
        "Client cannot be developer",
      );
    });

    it("reverts if client is the arbitrator", async function () {
      const { vault, developer, arbitrator } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject([developer.account.address, [parseEther("1")]], {
          account: arbitrator.account,
        }),
        "Arbitrator must be independent",
      );
    });

    it("reverts if developer is the arbitrator", async function () {
      const { vault, client, arbitrator } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject([arbitrator.account.address, [parseEther("1")]], {
          account: client.account,
        }),
        "Arbitrator must be independent",
      );
    });

    it("reverts if milestones array is empty", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject([developer.account.address, []], {
          account: client.account,
        }),
        "No milestones",
      );
    });

    it("reverts if milestone count exceeds MAX_MILESTONES (20)", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      const tooMany = Array.from({ length: 21 }, () => parseEther("0.1"));
      await viem.assertions.revertWith(
        vault.write.createProject([developer.account.address, tooMany], {
          account: client.account,
        }),
        "Too many milestones",
      );
    });

    it("allows creation with exactly MAX_MILESTONES (20)", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      const exactMax = Array.from({ length: 20 }, () => parseEther("0.1"));
      await vault.write.createProject([developer.account.address, exactMax], {
        account: client.account,
      });

      const project = await vault.read.getProject([1n]);
      assert.equal(project[4], 20n);
      assert.equal(project[2], parseEther("2"));
    });

    it("reverts if any milestone amount is zero", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await viem.assertions.revertWith(
        vault.write.createProject(
          [developer.account.address, [parseEther("1"), 0n, parseEther("1")]],
          { account: client.account },
        ),
        "Milestone amount is zero",
      );
    });
  });

  // =========================================================================
  // Project Funding (fundProject)
  // =========================================================================
  describe("Project Funding (fundProject)", function () {
    it("allows client to fund with exact total amount and updates state", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1"), parseEther("2")]],
        { account: client.account },
      );

      await viem.assertions.emitWithArgs(
        vault.write.fundProject([1n], {
          account: client.account,
          value: parseEther("3"),
        }),
        vault,
        "ProjectFunded",
        [1n, client.account.address, parseEther("3")],
      );

      const project = await vault.read.getProject([1n]);
      assert.equal(project[3], parseEther("3")); // remainingBalance
      assert.equal(project[5], true); // funded
    });

    it("reverts if funded with less than totalAmount", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("2")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([1n], {
          account: client.account,
          value: parseEther("1.99"),
        }),
        "Incorrect deposit amount",
      );
    });

    it("reverts if funded with more than totalAmount", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([1n], {
          account: client.account,
          value: parseEther("1.01"),
        }),
        "Incorrect deposit amount",
      );
    });

    it("reverts if non-client attempts to fund", async function () {
      const { vault, client, developer, stranger } =
        await networkHelpers.loadFixture(deployVaultFixture);
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([1n], {
          account: stranger.account,
          value: parseEther("1"),
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([1n], {
          account: developer.account,
          value: parseEther("1"),
        }),
        "Only client",
      );
    });

    it("reverts if project is already funded", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([projectId], {
          account: client.account,
          value: parseEther("3"),
        }),
        "Project already funded",
      );
    });

    it("reverts when funding a non-existent project", async function () {
      const { vault, client } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );

      await viem.assertions.revertWith(
        vault.write.fundProject([999n], {
          account: client.account,
          value: parseEther("1"),
        }),
        "Project does not exist",
      );
    });
  });

  // =========================================================================
  // Milestone Submission (submitMilestone)
  // =========================================================================
  describe("Milestone Submission (submitMilestone)", function () {
    it("allows developer to submit milestone with evidence hash", async function () {
      const { vault, developer, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.emitWithArgs(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
          account: developer.account,
        }),
        vault,
        "MilestoneSubmitted",
        [projectId, 0n, developer.account.address, SAMPLE_EVIDENCE],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Submitted);
      assert.equal(milestone[2], SAMPLE_EVIDENCE);
    });

    it("reverts submission if project is not funded", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([1n, 0n, SAMPLE_EVIDENCE], {
          account: developer.account,
        }),
        "Project not funded",
      );
    });

    it("reverts if non-developer tries to submit milestone", async function () {
      const { vault, client, stranger, arbitrator, projectId } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
          account: client.account,
        }),
        "Only developer",
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
          account: stranger.account,
        }),
        "Only developer",
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
          account: arbitrator.account,
        }),
        "Only developer",
      );
    });

    it("reverts submission for invalid milestone index", async function () {
      const { vault, developer, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 5n, SAMPLE_EVIDENCE], {
          account: developer.account,
        }),
        "Invalid milestone index",
      );
    });

    it("reverts if evidence hash is bytes32(0)", async function () {
      const { vault, developer, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, zeroHash], {
          account: developer.account,
        }),
        "Evidence hash is zero",
      );
    });

    it("reverts if milestone is already Submitted", async function () {
      const { vault, developer, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE_2], {
          account: developer.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts if milestone is Disputed", async function () {
      const { vault, developer, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE_2], {
          account: developer.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts if milestone is already Released", async function () {
      const { vault, client, developer, projectId } =
        await networkHelpers.loadFixture(submittedMilestoneFixture);

      await vault.write.approveMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE_2], {
          account: developer.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts if milestone is Refunded", async function () {
      const { vault, client, developer, projectId } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      await vault.write.refundPendingMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.submitMilestone([projectId, 0n, SAMPLE_EVIDENCE], {
          account: developer.account,
        }),
        "Invalid milestone state",
      );
    });
  });

  // =========================================================================
  // Milestone Approval & Payments (approveMilestone)
  // =========================================================================
  describe("Milestone Approval & Payments (approveMilestone)", function () {
    it("allows client to approve submitted milestone and transfers ETH to developer", async function () {
      const { vault, client, developer, projectId, amounts } =
        await networkHelpers.loadFixture(submittedMilestoneFixture);

      const milestoneAmount = amounts[0]; // 1 ETH

      await viem.assertions.balancesHaveChanged(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        [{ address: developer.account.address, amount: milestoneAmount }],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Released);

      const project = await vault.read.getProject([projectId]);
      assert.equal(project[3], parseEther("2")); // remaining: 3 - 1 = 2 ETH
    });

    it("emits FundsReleased and MilestoneApproved events in order", async function () {
      const { vault, client, developer, projectId, amounts } =
        await networkHelpers.loadFixture(submittedMilestoneFixture);

      await viem.assertions.emitWithArgs(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        vault,
        "FundsReleased",
        [projectId, 0n, developer.account.address, amounts[0]],
      );
    });

    it("reverts approval if project is not funded", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([1n, 0n], {
          account: client.account,
        }),
        "Project not funded",
      );
    });

    it("reverts if non-client attempts to approve milestone", async function () {
      const { vault, developer, stranger, arbitrator, projectId } =
        await networkHelpers.loadFixture(submittedMilestoneFixture);

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: developer.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: stranger.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: arbitrator.account,
        }),
        "Only client",
      );
    });

    it("reverts approval with invalid milestone index", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 10n], {
          account: client.account,
        }),
        "Invalid milestone index",
      );
    });

    it("reverts approval if milestone is still Pending", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts approval if milestone is Disputed", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts approval if milestone is already Released", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await vault.write.approveMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts approval if milestone is Refunded", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await vault.write.refundPendingMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.approveMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });
  });

  // =========================================================================
  // Milestone Disputes (disputeMilestone)
  // =========================================================================
  describe("Milestone Disputes (disputeMilestone)", function () {
    it("allows client to dispute a Submitted milestone", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.emitWithArgs(
        vault.write.disputeMilestone([projectId, 0n], {
          account: client.account,
        }),
        vault,
        "MilestoneDisputed",
        [projectId, 0n, client.account.address],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Disputed);
    });

    it("reverts dispute if project is not funded", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([1n, 0n], {
          account: client.account,
        }),
        "Project not funded",
      );
    });

    it("reverts if non-client attempts to dispute (developer, arbitrator, stranger)", async function () {
      const { vault, developer, arbitrator, stranger, projectId } =
        await networkHelpers.loadFixture(submittedMilestoneFixture);

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: developer.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: arbitrator.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: stranger.account,
        }),
        "Only client",
      );
    });

    it("reverts dispute with invalid milestone index", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 9n], {
          account: client.account,
        }),
        "Invalid milestone index",
      );
    });

    it("reverts dispute if milestone is Pending", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts dispute if milestone is already Disputed", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts dispute if milestone is already Released", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await vault.write.approveMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts dispute if milestone is Refunded", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await vault.write.refundPendingMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.disputeMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });
  });

  // =========================================================================
  // Arbitrator Dispute Resolution (resolveDispute)
  // =========================================================================
  describe("Arbitrator Dispute Resolution (resolveDispute)", function () {
    it("allows arbitrator to resolve dispute by releasing funds to developer", async function () {
      const { vault, developer, arbitrator, projectId, amounts } =
        await networkHelpers.loadFixture(disputedMilestoneFixture);

      const milestoneAmount = amounts[0]; // 1 ETH

      await viem.assertions.balancesHaveChanged(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: arbitrator.account,
        }),
        [{ address: developer.account.address, amount: milestoneAmount }],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Released);

      const project = await vault.read.getProject([projectId]);
      assert.equal(project[3], parseEther("2"));
    });

    it("emits FundsReleased and MilestoneResolved events when releasing to developer", async function () {
      const { vault, developer, arbitrator, projectId, amounts } =
        await networkHelpers.loadFixture(disputedMilestoneFixture);

      await viem.assertions.emitWithArgs(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: arbitrator.account,
        }),
        vault,
        "MilestoneResolved",
        [projectId, 0n, arbitrator.account.address, true],
      );
    });

    it("allows arbitrator to resolve dispute by refunding funds to client", async function () {
      const { vault, client, arbitrator, projectId, amounts } =
        await networkHelpers.loadFixture(disputedMilestoneFixture);

      const milestoneAmount = amounts[0]; // 1 ETH

      await viem.assertions.balancesHaveChanged(
        vault.write.resolveDispute([projectId, 0n, false], {
          account: arbitrator.account,
        }),
        [{ address: client.account.address, amount: milestoneAmount }],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Refunded);

      const project = await vault.read.getProject([projectId]);
      assert.equal(project[3], parseEther("2"));
    });

    it("emits FundsRefunded and MilestoneResolved events when refunding client", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.emitWithArgs(
        vault.write.resolveDispute([projectId, 0n, false], {
          account: arbitrator.account,
        }),
        vault,
        "MilestoneResolved",
        [projectId, 0n, arbitrator.account.address, false],
      );
    });

    it("reverts if non-arbitrator attempts to resolve dispute", async function () {
      const { vault, client, developer, stranger, projectId } =
        await networkHelpers.loadFixture(disputedMilestoneFixture);

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: client.account,
        }),
        "Only arbitrator",
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: developer.account,
        }),
        "Only arbitrator",
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: stranger.account,
        }),
        "Only arbitrator",
      );
    });

    it("reverts resolution if project is not funded", async function () {
      const { vault, client, developer, arbitrator } =
        await networkHelpers.loadFixture(deployVaultFixture);
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([1n, 0n, true], {
          account: arbitrator.account,
        }),
        "Project not funded",
      );
    });

    it("reverts resolution with invalid milestone index", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 4n, true], {
          account: arbitrator.account,
        }),
        "Invalid milestone index",
      );
    });

    it("reverts resolution if milestone is Pending", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: arbitrator.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts resolution if milestone is Submitted but not Disputed", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: arbitrator.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts resolution if milestone is already Released", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await vault.write.resolveDispute([projectId, 0n, true], {
        account: arbitrator.account,
      });

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, true], {
          account: arbitrator.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts resolution if milestone is already Refunded", async function () {
      const { vault, arbitrator, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await vault.write.resolveDispute([projectId, 0n, false], {
        account: arbitrator.account,
      });

      await viem.assertions.revertWith(
        vault.write.resolveDispute([projectId, 0n, false], {
          account: arbitrator.account,
        }),
        "Invalid milestone state",
      );
    });
  });

  // =========================================================================
  // Client Cancellation of Pending Milestone (refundPendingMilestone)
  // =========================================================================
  describe("Client Refund of Pending Milestones (refundPendingMilestone)", function () {
    it("allows client to refund a Pending milestone before developer submits", async function () {
      const { vault, client, projectId, amounts } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      const milestoneAmount = amounts[0]; // 1 ETH

      await viem.assertions.balancesHaveChanged(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        [{ address: client.account.address, amount: milestoneAmount }],
      );

      const milestone = await vault.read.getMilestone([projectId, 0n]);
      assert.equal(milestone[1], MilestoneStatus.Refunded);

      const project = await vault.read.getProject([projectId]);
      assert.equal(project[3], parseEther("2"));
    });

    it("emits FundsRefunded event on pending milestone refund", async function () {
      const { vault, client, projectId, amounts } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      await viem.assertions.emitWithArgs(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        vault,
        "FundsRefunded",
        [projectId, 0n, client.account.address, amounts[0]],
      );
    });

    it("reverts pending refund if project is not funded", async function () {
      const { vault, client, developer } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([1n, 0n], {
          account: client.account,
        }),
        "Project not funded",
      );
    });

    it("reverts if non-client attempts to refund pending milestone", async function () {
      const { vault, developer, arbitrator, stranger, projectId } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: developer.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: arbitrator.account,
        }),
        "Only client",
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: stranger.account,
        }),
        "Only client",
      );
    });

    it("reverts pending refund with invalid milestone index", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 9n], {
          account: client.account,
        }),
        "Invalid milestone index",
      );
    });

    it("reverts pending refund once milestone is Submitted", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts pending refund once milestone is Disputed", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        disputedMilestoneFixture,
      );

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts pending refund once milestone is already Released", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        submittedMilestoneFixture,
      );

      await vault.write.approveMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });

    it("reverts pending refund once milestone is already Refunded", async function () {
      const { vault, client, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await vault.write.refundPendingMilestone([projectId, 0n], {
        account: client.account,
      });

      await viem.assertions.revertWith(
        vault.write.refundPendingMilestone([projectId, 0n], {
          account: client.account,
        }),
        "Invalid milestone state",
      );
    });
  });

  // =========================================================================
  // View Functions & Rejection of Direct Transfers
  // =========================================================================
  describe("View Functions & ETH Rejection", function () {
    it("getProject returns correct details for an existing project", async function () {
      const { vault, client, developer, projectId } =
        await networkHelpers.loadFixture(fundedProjectFixture);

      const p = await vault.read.getProject([projectId]);
      assert.equal(p[0].toLowerCase(), client.account.address.toLowerCase());
      assert.equal(p[1].toLowerCase(), developer.account.address.toLowerCase());
      assert.equal(p[2], parseEther("3")); // totalAmount
      assert.equal(p[3], parseEther("3")); // remainingBalance
      assert.equal(p[4], 2n); // milestoneCount
      assert.equal(p[5], true); // funded
    });

    it("getProject reverts for a non-existent project", async function () {
      const { vault } = await networkHelpers.loadFixture(deployVaultFixture);

      await viem.assertions.revertWith(
        vault.read.getProject([0n]),
        "Project does not exist",
      );

      await viem.assertions.revertWith(
        vault.read.getProject([42n]),
        "Project does not exist",
      );
    });

    it("getMilestone reverts for invalid milestone index", async function () {
      const { vault, projectId } = await networkHelpers.loadFixture(
        fundedProjectFixture,
      );

      await viem.assertions.revertWith(
        vault.read.getMilestone([projectId, 2n]),
        "Invalid milestone index",
      );
    });

    it("getMilestone reverts for non-existent project", async function () {
      const { vault } = await networkHelpers.loadFixture(deployVaultFixture);

      await viem.assertions.revertWith(
        vault.read.getMilestone([999n, 0n]),
        "Project does not exist",
      );
    });

    it("rejects plain ETH transfers with no calldata", async function () {
      const { vault, client } = await networkHelpers.loadFixture(
        deployVaultFixture,
      );

      await assert.rejects(async () => {
        await client.sendTransaction({
          to: vault.address,
          value: parseEther("1"),
        });
      });
    });
  });

  // =========================================================================
  // Multi-Milestone Full Lifecycle & Accounting Invariants
  // =========================================================================
  describe("End-to-End Multi-Milestone Lifecycle & Balances", function () {
    it("exercises all 4 milestone paths within a single project and verifies exact ETH accounting", async function () {
      const { vault, client, developer, arbitrator, publicClient } =
        await networkHelpers.loadFixture(deployVaultFixture);

      // Create project with 4 milestones: 1 ETH, 2 ETH, 3 ETH, 4 ETH = 10 ETH total
      const amounts = [
        parseEther("1"),
        parseEther("2"),
        parseEther("3"),
        parseEther("4"),
      ];
      await vault.write.createProject([developer.account.address, amounts], {
        account: client.account,
      });

      // Fund project with exact 10 ETH
      await vault.write.fundProject([1n], {
        account: client.account,
        value: parseEther("10"),
      });

      let vaultBalance = await publicClient.getBalance({ address: vault.address });
      assert.equal(vaultBalance, parseEther("10"));

      // 1. Milestone 0: Submit -> Approve -> Paid to Developer (1 ETH)
      await vault.write.submitMilestone([1n, 0n, SAMPLE_EVIDENCE], {
        account: developer.account,
      });
      await viem.assertions.balancesHaveChanged(
        vault.write.approveMilestone([1n, 0n], {
          account: client.account,
        }),
        [{ address: developer.account.address, amount: parseEther("1") }],
      );
      let project = await vault.read.getProject([1n]);
      assert.equal(project[3], parseEther("9"));

      // 2. Milestone 1: Submit -> Dispute -> Arbitrator awards Developer (2 ETH)
      await vault.write.submitMilestone([1n, 1n, SAMPLE_EVIDENCE], {
        account: developer.account,
      });
      await vault.write.disputeMilestone([1n, 1n], {
        account: client.account,
      });
      await viem.assertions.balancesHaveChanged(
        vault.write.resolveDispute([1n, 1n, true], {
          account: arbitrator.account,
        }),
        [{ address: developer.account.address, amount: parseEther("2") }],
      );
      project = await vault.read.getProject([1n]);
      assert.equal(project[3], parseEther("7"));

      // 3. Milestone 2: Submit -> Dispute -> Arbitrator refunds Client (3 ETH)
      await vault.write.submitMilestone([1n, 2n, SAMPLE_EVIDENCE], {
        account: developer.account,
      });
      await vault.write.disputeMilestone([1n, 2n], {
        account: client.account,
      });
      await viem.assertions.balancesHaveChanged(
        vault.write.resolveDispute([1n, 2n, false], {
          account: arbitrator.account,
        }),
        [{ address: client.account.address, amount: parseEther("3") }],
      );
      project = await vault.read.getProject([1n]);
      assert.equal(project[3], parseEther("4"));

      // 4. Milestone 3: Client refunds pending milestone (4 ETH)
      await viem.assertions.balancesHaveChanged(
        vault.write.refundPendingMilestone([1n, 3n], {
          account: client.account,
        }),
        [{ address: client.account.address, amount: parseEther("4") }],
      );
      project = await vault.read.getProject([1n]);
      assert.equal(project[3], 0n);

      // Verify all milestone terminal states
      const m0 = await vault.read.getMilestone([1n, 0n]);
      const m1 = await vault.read.getMilestone([1n, 1n]);
      const m2 = await vault.read.getMilestone([1n, 2n]);
      const m3 = await vault.read.getMilestone([1n, 3n]);

      assert.equal(m0[1], MilestoneStatus.Released);
      assert.equal(m1[1], MilestoneStatus.Released);
      assert.equal(m2[1], MilestoneStatus.Refunded);
      assert.equal(m3[1], MilestoneStatus.Refunded);

      // Contract balance should be exactly 0 ETH
      vaultBalance = await publicClient.getBalance({ address: vault.address });
      assert.equal(vaultBalance, 0n);
    });

    it("isolates accounting and execution across multiple independent projects", async function () {
      const { vault, client, developer, other, stranger } =
        await networkHelpers.loadFixture(deployVaultFixture);

      // Project 1: client & developer, 1 ETH
      await vault.write.createProject(
        [developer.account.address, [parseEther("1")]],
        { account: client.account },
      );
      await vault.write.fundProject([1n], {
        account: client.account,
        value: parseEther("1"),
      });

      // Project 2: other & stranger, 5 ETH
      await vault.write.createProject(
        [stranger.account.address, [parseEther("5")]],
        { account: other.account },
      );
      await vault.write.fundProject([2n], {
        account: other.account,
        value: parseEther("5"),
      });

      // Actions on project 1 cannot be performed by project 2 participants
      await viem.assertions.revertWith(
        vault.write.submitMilestone([1n, 0n, SAMPLE_EVIDENCE], {
          account: stranger.account,
        }),
        "Only developer",
      );
      await viem.assertions.revertWith(
        vault.write.approveMilestone([1n, 0n], {
          account: other.account,
        }),
        "Only client",
      );

      // Release project 1
      await vault.write.submitMilestone([1n, 0n, SAMPLE_EVIDENCE], {
        account: developer.account,
      });
      await vault.write.approveMilestone([1n, 0n], {
        account: client.account,
      });

      // Project 1 balance is 0, Project 2 balance is still 5 ETH
      const p1 = await vault.read.getProject([1n]);
      const p2 = await vault.read.getProject([2n]);
      assert.equal(p1[3], 0n);
      assert.equal(p2[3], parseEther("5"));
    });
  });
});