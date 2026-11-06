# Setup verification

Verified locally on November 5, 2026.

## Toolchain

- Node.js 24.22.2 LTS, activated per PowerShell session.
- Python 3.12.13 with a uv-managed environment in `backend/.venv`.
- Foundry 1.7.1: Forge, Cast, Anvil, Chisel, installed through official npm packages.
- Hardhat 3.21.2 with Solidity 0.8.34, viem, Ignition, forge-std, and OpenZeppelin.
- Vite 8.3.5, React, TypeScript, wagmi, RainbowKit, ethers, viem, TanStack Query, Zod.
- Docker Engine and Compose in the existing Kali WSL distribution.
- Local PostgreSQL 17 and Redis 7 containers.

## Passed

- `scripts/verify.ps1` from PowerShell.
- Frontend lint, TypeScript check, production build, and HTTP response on port 5174.
- Hardhat compilation, 3 Solidity tests and 2 TypeScript integration tests.
- Contract TypeScript typecheck.
- Foundry compilation and 3 Solidity tests, including 256 fuzz runs.
- Python lint and the API health test.
- API health check through its HTTP interface.
- web3.py connection to Anvil, chain ID 31337, and a successful local ETH transfer.
- PostgreSQL connection and query from Windows Python into the WSL container.
- Redis write, read, and deletion from Windows Python into the WSL container.
- Database data preservation across Compose `down` and `up`.

The API test currently reports an upstream Starlette warning about its HTTPX test-client compatibility. The test passes.

## Scope

Only generic public starter examples and local tooling are included. No project-specific protocol, sponsor integration, wallet account, cloud resources, credentials, testnet deployment, or live payment setup has been created. The Vite UI is the public starter. Wallet libraries are installed but not wired into it.

JavaScript dependencies are locked in `package-lock.json`; Python dependencies are locked in `backend/uv.lock`. An ignored `.local/wheels` cache contains checksum-verified Windows Python wheels used to work around a temporary download problem. Reuse commands are in `README.md`.
