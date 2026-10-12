# MilestoneVault

Hackathon foundation for a Solidity milestone-escrow prototype. This repo is for **local Hardhat development and testing only**. It uses simulated test ETH. Do **not** send real funds and do **not** deploy to a public network.

This starter is unfinished. It is **not audited** and is **not claimed to be secure**.

## Layout

- `contracts/` — Solidity contracts (`MilestoneVault.sol` starter)
- `test/` — automated TypeScript tests
- `scripts/` — local deploy helper
- `ignition/modules/` — local Ignition module
- `frontend/` — placeholder for a later React + Vite + TypeScript app

## Prerequisites (Windows)

1. Node.js 22.13+ (this machine uses Node.js 24 LTS)
2. npm (bundled with Node.js)
3. PowerShell

If `node` is not recognized in a new terminal, close and reopen it, or add `C:\Program Files\nodejs` to PATH.

## Setup

From `D:\Milestone Vault`:

```powershell
npm install
```

## Compile

```powershell
npx hardhat compile
```

## Test

```powershell
npx hardhat test
```

TypeScript tests only:

```powershell
npx hardhat test nodejs
```

## Local node (optional)

```powershell
npx hardhat node
```

In a second terminal, deploy to that local node:

```powershell
npx hardhat run scripts/deploy.ts --network localhost
```

Or with Ignition on the in-process simulated network:

```powershell
npx hardhat ignition deploy ignition/modules/MilestoneVault.ts
```

## Frontend

The UI is not part of this foundation. See `frontend/README.md`.

## Out of scope

- Full escrow / milestone release logic
- AI extras and API keys
- Public RPC URLs, mainnet, or testnet deployment
- Production secrets (do not add a funded `.env`)
