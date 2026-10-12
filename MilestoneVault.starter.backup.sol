// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

/// @title MilestoneVault
/// @notice Starter contract for a local-only milestone escrow prototype.
/// @dev Foundation only. Not audited. Do not use with real funds or public networks.
contract MilestoneVault {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function version() external pure returns (string memory) {
        return "0.1.0-foundation";
    }
}
