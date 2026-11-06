require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.whitechain.io";
const accounts = process.env.PLATFORM_ADMIN_KEY ? [process.env.PLATFORM_ADMIN_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true, // structs with many fields; avoids "stack too deep"
    },
  },
  networks: {
    hardhat:
      process.env.FORK === "1"
        ? { forking: { url: RPC_URL }, chainId: 1874 } // fork tests against real USDT / YetiTrade
        : {},
    whitechainTestnet: {
      url: RPC_URL,
      chainId: 1874,
      accounts,
    },
  },
  // Blockscout verification (hardhat-verify). Blockscout ignores the API key, but one must be set.
  etherscan: {
    apiKey: { whitechainTestnet: "blockscout" },
    customChains: [
      {
        network: "whitechainTestnet",
        chainId: 1874,
        urls: {
          apiURL: "https://explorer.testnet.whitechain.io/api",
          browserURL: "https://explorer.testnet.whitechain.io",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: { enabled: !!process.env.REPORT_GAS },
};
