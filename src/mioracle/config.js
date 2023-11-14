const networkId = {
  baseGoerli: 84531,
}

const config = {
  // wallet
  // baseGoerli
  // address signer
  deployer: '0x41BC7208d03a38FD6AA29057648019C4e93049b6', // signer1
  signer2: '0xC2829C12c1Ca8D700A9C94Da66d241E1790a900C',
  signer3: '0xc3ec961EECB978bca30A75f9f756bBAB5e36B532',
  keeper: '0xC1442936F623Ae86c45Bd29FeB22f2208A0d9A4B',
  liquidator: '0xE8C342054490501E5dA6a722bE4360F6cadD12BF',

  // fees
  feeReceiver: '0x41c6Ad25a673673A53c6CFA615379C473275D4CA', // execute fee
  mintReceiver: '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',
  proxyAdmin: '0x41c6Ad25a673673A53c6CFA615379C473275D4CA',
  priceFeedSigners: [
    '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',
    '0xC858e868D3644Abd2b04217b3c4F52C396f4e181',
    '0x9CC224EE6EA90d52E0a82893A7aB466E2a10F25B',
    '0xf781FC2f7D12EdbbE439221eD38DDF6f26215FFc',
  ],
  relayNodes: ['0xC1442936F623Ae86c45Bd29FeB22f2208A0d9A4B', '0xE8C342054490501E5dA6a722bE4360F6cadD12BF'],
  // tokens
  tokens: {
    84531: {
      // baseGoerli
      weth: '0x6c4eE95dfE63b13e6f3FaBd0Cbca81D41FF8f87f',
    },
  },
  // api
  priceFeedApi: 'https://api.xoracle.io/prices/priceFeed/',
}

module.exports = { networkId, config }
