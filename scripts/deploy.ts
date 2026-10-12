import { network } from "hardhat";

const { viem } = await network.create();

const vault = await viem.deployContract("MilestoneVault");

console.log("MilestoneVault deployed locally at", vault.address);
console.log("This script is for the Hardhat local network only. Do not use real funds.");
