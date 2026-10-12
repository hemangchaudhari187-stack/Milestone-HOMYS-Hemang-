// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MilestoneVault
/// @notice Local-demo escrow: a client funds milestones, and a fixed arbitrator
///         resolves disputes. This contract has not been audited.
contract MilestoneVault is ReentrancyGuard {
    uint256 public constant MAX_MILESTONES = 20;

    enum MilestoneStatus {
        Pending,
        Submitted,
        Disputed,
        Released,
        Refunded
    }

    struct Project {
        address client;
        address developer;
        uint256 totalAmount;
        uint256 remainingBalance;
        uint256 milestoneCount;
        bool funded;
    }

    struct Milestone {
        uint256 amount;
        MilestoneStatus status;
        bytes32 evidenceHash;
    }

    /// @notice One trusted dispute resolver for this deployment.
    address public immutable arbitrator;
    uint256 public nextProjectId = 1;

    mapping(uint256 => Project) private _projects;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address indexed developer,
        uint256 totalAmount,
        uint256 milestoneCount
    );
    event ProjectFunded(uint256 indexed projectId, address indexed client, uint256 amount);
    event MilestoneSubmitted(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed developer,
        bytes32 evidenceHash
    );
    event MilestoneApproved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed client
    );
    event MilestoneDisputed(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed client
    );
    event MilestoneResolved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed arbitrator,
        bool releaseToDeveloper
    );
    event FundsReleased(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed developer,
        uint256 amount
    );
    event FundsRefunded(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed client,
        uint256 amount
    );

    constructor(address arbitrator_) {
        require(arbitrator_ != address(0), "Arbitrator is zero address");
        arbitrator = arbitrator_;
    }

    /// @notice Create a project and its immutable milestone amounts.
    /// @dev Funding is a separate exact-value transaction via fundProject().
    function createProject(
        address developer_,
        uint256[] calldata milestoneAmounts
    ) external returns (uint256 projectId) {
        require(developer_ != address(0), "Developer is zero address");
        require(developer_ != msg.sender, "Client cannot be developer");
        require(msg.sender != arbitrator && developer_ != arbitrator, "Arbitrator must be independent");
        require(milestoneAmounts.length > 0, "No milestones");
        require(milestoneAmounts.length <= MAX_MILESTONES, "Too many milestones");

        uint256 totalAmount;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "Milestone amount is zero");
            totalAmount += milestoneAmounts[i]; // Solidity 0.8+ checks overflow.
        }

        projectId = nextProjectId++;
        Project storage project = _projects[projectId];
        project.client = msg.sender;
        project.developer = developer_;
        project.totalAmount = totalAmount;
        project.milestoneCount = milestoneAmounts.length;
        project.funded = false;
        project.remainingBalance = 0;

        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            _milestones[projectId][i] = Milestone({
                amount: milestoneAmounts[i],
                status: MilestoneStatus.Pending,
                evidenceHash: bytes32(0)
            });
        }

        emit ProjectCreated(projectId, msg.sender, developer_, totalAmount, milestoneAmounts.length);
    }

    /// @notice Fund all milestones in one transaction with the exact total.
    function fundProject(uint256 projectId) external payable nonReentrant {
        Project storage project = _requireProject(projectId);
        require(msg.sender == project.client, "Only client");
        require(!project.funded, "Project already funded");
        require(msg.value == project.totalAmount, "Incorrect deposit amount");

        project.funded = true;
        project.remainingBalance = project.totalAmount;
        emit ProjectFunded(projectId, msg.sender, msg.value);
    }

    /// @notice Developer submits a non-zero hash of off-chain milestone evidence.
    function submitMilestone(
        uint256 projectId,
        uint256 milestoneIndex,
        bytes32 evidenceHash
    ) external {
        Project storage project = _requireProject(projectId);
        require(project.funded, "Project not funded");
        require(msg.sender == project.developer, "Only developer");
        _requireValidIndex(project, milestoneIndex);

        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        require(milestone.status == MilestoneStatus.Pending, "Invalid milestone state");
        require(evidenceHash != bytes32(0), "Evidence hash is zero");

        milestone.evidenceHash = evidenceHash;
        milestone.status = MilestoneStatus.Submitted;
        emit MilestoneSubmitted(projectId, milestoneIndex, msg.sender, evidenceHash);
    }

    /// @notice Client approves a submitted milestone; funds are paid immediately.
    function approveMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external nonReentrant {
        Project storage project = _requireProject(projectId);
        require(project.funded, "Project not funded");
        require(msg.sender == project.client, "Only client");
        _requireValidIndex(project, milestoneIndex);

        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        require(milestone.status == MilestoneStatus.Submitted, "Invalid milestone state");

        _release(projectId, milestoneIndex, project, milestone);
        emit MilestoneApproved(projectId, milestoneIndex, msg.sender);
    }

    /// @notice Client disputes a submitted milestone for the arbitrator to resolve.
    function disputeMilestone(uint256 projectId, uint256 milestoneIndex) external {
        Project storage project = _requireProject(projectId);
        require(project.funded, "Project not funded");
        require(msg.sender == project.client, "Only client");
        _requireValidIndex(project, milestoneIndex);

        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        require(milestone.status == MilestoneStatus.Submitted, "Invalid milestone state");

        milestone.status = MilestoneStatus.Disputed;
        emit MilestoneDisputed(projectId, milestoneIndex, msg.sender);
    }

    /// @notice The immutable arbitrator resolves a dispute in one of two ways:
    ///         release that milestone's amount to the developer, or refund it to the client.
    function resolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        bool releaseToDeveloper
    ) external nonReentrant {
        require(msg.sender == arbitrator, "Only arbitrator");
        Project storage project = _requireProject(projectId);
        require(project.funded, "Project not funded");
        _requireValidIndex(project, milestoneIndex);

        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        require(milestone.status == MilestoneStatus.Disputed, "Invalid milestone state");

        if (releaseToDeveloper) {
            _release(projectId, milestoneIndex, project, milestone);
        } else {
            _refund(projectId, milestoneIndex, project, milestone);
        }

        emit MilestoneResolved(projectId, milestoneIndex, msg.sender, releaseToDeveloper);
    }

    /// @notice Client may cancel/refund a milestone only before the developer submits it.
    /// @dev Once submitted, only the defined dispute path can decide the funds' destination.
    function refundPendingMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external nonReentrant {
        Project storage project = _requireProject(projectId);
        require(project.funded, "Project not funded");
        require(msg.sender == project.client, "Only client");
        _requireValidIndex(project, milestoneIndex);

        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        require(milestone.status == MilestoneStatus.Pending, "Invalid milestone state");
        _refund(projectId, milestoneIndex, project, milestone);
    }

    function getProject(
        uint256 projectId
    ) external view returns (
        address client,
        address developer,
        uint256 totalAmount,
        uint256 remainingBalance,
        uint256 milestoneCount,
        bool funded
    ) {
        Project storage project = _requireProject(projectId);
        return (
            project.client,
            project.developer,
            project.totalAmount,
            project.remainingBalance,
            project.milestoneCount,
            project.funded
        );
    }

    function getMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external view returns (uint256 amount, MilestoneStatus status, bytes32 evidenceHash) {
        Project storage project = _requireProject(projectId);
        _requireValidIndex(project, milestoneIndex);
        Milestone storage milestone = _milestones[projectId][milestoneIndex];
        return (milestone.amount, milestone.status, milestone.evidenceHash);
    }

    function _release(
        uint256 projectId,
        uint256 milestoneIndex,
        Project storage project,
        Milestone storage milestone
    ) private {
        uint256 amount = milestone.amount;
        require(project.remainingBalance >= amount, "Insufficient project balance");

        // Checks-effects-interactions: make the milestone terminal and decrement
        // the project's accounting before transferring ETH to the recipient.
        milestone.status = MilestoneStatus.Released;
        project.remainingBalance -= amount;

        (bool success, ) = payable(project.developer).call{value: amount}("");
        require(success, "Developer payment failed");
        emit FundsReleased(projectId, milestoneIndex, project.developer, amount);
    }

    function _refund(
        uint256 projectId,
        uint256 milestoneIndex,
        Project storage project,
        Milestone storage milestone
    ) private {
        uint256 amount = milestone.amount;
        require(project.remainingBalance >= amount, "Insufficient project balance");

        // Same checks-effects-interactions ordering for client refunds.
        milestone.status = MilestoneStatus.Refunded;
        project.remainingBalance -= amount;

        (bool success, ) = payable(project.client).call{value: amount}("");
        require(success, "Client refund failed");
        emit FundsRefunded(projectId, milestoneIndex, project.client, amount);
    }

    function _requireProject(uint256 projectId) private view returns (Project storage project) {
        project = _projects[projectId];
        require(project.client != address(0), "Project does not exist");
    }

    function _requireValidIndex(Project storage project, uint256 milestoneIndex) private view {
        require(milestoneIndex < project.milestoneCount, "Invalid milestone index");
    }
}
