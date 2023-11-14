import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";

import * as dotenv from "dotenv";
dotenv.config();

// tasks
import "./tasks/accounts";

// configs
const config: HardhatUserConfig = {
  namedAccounts: {
    wallet: {
      default: 0,
    },
    alice: {
      default: 11,
    },
    bobby: {
      default: 2,
    },
    carol: {
      default: 3,
    },
    derek: {
      default: 4,
    },
    feeTo: {
      default: 5,
    },
    wethDeployer: {
      default: 1,
    },
  },
  networks: {
    hardhat: {
      blockGasLimit: 30000000,
      deploy: ["deploys/baseGoerli"],
    },
    testnet: {
      url: "https://opbnb-testnet.nodereal.io/v1/e9a36765eb8a40b9bd12e680a1fd2bc5/",
      chainId: 5611,
      accounts: {
        mnemonic: process.env.MNEMONIC || "test test test test test test test test test test test junk",
        accountsBalance: "990000000000000000000",
      },
      gasPrice: 200_800,
      deploy: ["deploy"],
    },
    mainnet: {
      url: "https://opbnb-mainnet-rpc.bnbchain.org/",
      chainId: 204,
      accounts: {
        mnemonic: `${process.env.MNEMONIC_MAINNET}`,
      },
      gasPrice: 1_008_000,
      deploy: ["deployM"],
    },
    bsc: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: {
        mnemonic: "main debate shine notice outdoor void witness cover offer parent junior drink",
        count: 60,
      },
      gasPrice: 10_000_000_000,
    },
    baseGoerli: {
      url: `${process.env.BASE_GOERLI_RPC}`,
      chainId: parseInt(`${process.env.BASE_GOERLI_CHAIN_ID}`),
      gasPrice: parseInt(`${process.env.BASE_GOERLI_GAS_PRICE}`) * 10 ** 5,
      accounts: { mnemonic: `${process.env.MNEMONIC_MAINNET}` },
      deploy: ["deploys/baseGoerli"],
    },
  },
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 777,
      },
      metadata: {
        bytecodeHash: "none",
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  paths: {
    tests: "./test",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "mainnet",
        chainId: 204,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.OPBNB_TESTNET_API_KEY}/op-bnb-mainnet/contract/`,
          browserURL: "https://opbnbscan.com/",
        },
      },
      {
        network: "testnet",
        chainId: 5611,
        urls: {
          apiURL: `https://open-platform.nodereal.io/${process.env.OPBNB_MAINNET_API_KEY}/op-bnb-testnet/contract/`,
          browserURL: "https://testnet.opbnbscan.com/",
        },
      },
      {
        network: "baseGoerli",
        chainId: parseInt(`${process.env.BASE_GOERLI_CHAIN_ID}`),
        urls: {
          apiURL: `${process.env.BASE_GOERLI_VERIFY_API_URL}`,
          browserURL: `${process.env.BASE_GOERLI_SCAN_URL}`,
        },
      },
    ],
  },
};

export default config;
