require('dotenv').config()
require('@nomiclabs/hardhat-etherscan')
require('@nomiclabs/hardhat-waffle')
require('solidity-coverage')
require('@nomiclabs/hardhat-web3')

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()

  for (const account of accounts) {
    const balance = await hre.ethers.provider.getBalance(account.address)
    console.log(account.address, balance.toString())
  }
})

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.18',
        settings: {
          optimizer: {
            enabled: true,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    baseGoerli: {
      url: `${process.env.BASE_GOERLI_RPC}`,
      chainId: parseInt(`${process.env.BASE_GOERLI_CHAIN_ID}`),
      gasPrice: parseInt(`${process.env.BASE_GOERLI_GAS_PRICE}`) * 10 ** 5,
      accounts: { mnemonic: `${process.env.BASE_GOERLI_MNEMONIC}` },
    },
  },
  etherscan: {
    apiKey: {
      baseGoerli: `${process.env.BASE_GOERLI_API_KEY}`,
    },
    customChains: [
      {
        network: 'baseGoerli',
        chainId: parseInt(`${process.env.BASE_GOERLI_CHAIN_ID}`),
        urls: {
          apiURL: `${process.env.BASE_GOERLI_VERIFY_API_URL}`,
          browserURL: `${process.env.BASE_GOERLI_SCAN_URL}`,
        },
      },
    ],
  },
  mocha: {
    timeout: 500000,
  },
}
