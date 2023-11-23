const networkId = {
    baseGoerli: 84531,
}

const priceFeedApi = 'https://api.xoracle.io/prices/priceFeed/'

const priceFeedSigners = [
    { publicAddress: '0xaFBCF42F633a02A5009c6c026A4699D673E51b0f', privateKey: '0xe4b848165442612870323559f4965c8acddaf7037cc9688108d2ec351560c145' },
    { publicAddress: '0x9095568cE340ebFAD62A03B17FDfDCDbdf55808d', privateKey: '0xb48a060bd5a86b1641607dc42b679fd0037ede4ec6afc82bbc2e541e62208b6d' },
    { publicAddress: '0x2e2d86cA4155d49E503f48C0Cef7423C0230B55b', privateKey: '0x981440bd742c0af527c0b7bf8e2644dced127fa5f87923333671671aebe8ae41' },
    { publicAddress: '0x15cD0016B48c31cF6579a73ad969dFB89424D236', privateKey: '0x3097f10378091f801fa0d1be9b5a87b67ea53e2d924613866bac707df61d1a9b' },
    { publicAddress: '0x403b0399B77c2Bda2972a237242B61f261014e1d', privateKey: '0xf821b20abd85361ec98fa19217200a6f51394983b6e72065b482fd504d44fcb5' },
    { publicAddress: '0x5B2b18296b24a62B499eaA72079db4Bc3F93cC68', privateKey: '0x454c43457d86a0a7f440ca3f0d3e731cf9d227feee57c173c224934339bb629c' },
    { publicAddress: '0xa6c37E918b7BC6BD83E732D2F8411213f98f4a9A', privateKey: '0x24339c9d6b7da92003d4c92db702cb3c110c24fb5406d613d29e53ea96fdb1b2' },
    { publicAddress: '0x000912b43D511228Ff22956B4C6EB958a0125E69', privateKey: '0x77baeb9d731d7fc6ce01e68a64fd8ff7e8c344173f930cb4a472e46c3ad9bb85' },
    { publicAddress: '0x5D62257394c5aac2dEdf30192B91d01B395c119c', privateKey: '0x84ca1d31899adaed422b26a0d96ee4dfd3727c7ba99ac2c5f81a3b7915f64e94' },
    { publicAddress: '0x98e58c0D821152E90F702973B26C67736fc65041', privateKey: '0xbc907b94feb0e7dcbadb82f22539692c73159bddefaeec780f15e7dd6ebba2ee' },
]

const tokenIndexes = {
    BTC: 0,
    ETH: 1,
    BNB: 2,
    USDT: 3,
    BUSD: 4,
    USDC: 5,
    DAI: 6,
    XRP: 10,
    DOGE: 11,
    TRX: 12,
    ADA: 20,
    MATIC: 21,
    SOL: 22,
    DOT: 23,
    LINK: 24,
    FTM: 25,
    NEAR: 26,
    ATOM: 27,
    OP: 28,
    ARB: 29,
}
const symbols = {
    [tokenIndexes.BTC]: 'BTC',
    [tokenIndexes.ETH]: 'ETH',
    [tokenIndexes.BNB]: 'BNB',
    [tokenIndexes.USDT]: 'USDT',
    [tokenIndexes.BUSD]: 'BUSD',
    [tokenIndexes.USDC]: 'USDC',
    [tokenIndexes.DAI]: 'DAI',
    [tokenIndexes.XRP]: 'XRP',
    [tokenIndexes.DOGE]: 'DOGE',
    [tokenIndexes.TRX]: 'TRX',
    [tokenIndexes.ADA]: 'ADA',
    [tokenIndexes.MATIC]: 'MATIC',
    [tokenIndexes.SOL]: 'SOL',
    [tokenIndexes.DOT]: 'DOT',
    [tokenIndexes.LINK]: 'LINK',
    [tokenIndexes.FTM]: 'FTM',
    [tokenIndexes.NEAR]: 'NEAR',
    [tokenIndexes.ATOM]: 'ATOM',
    [tokenIndexes.OP]: 'OP',
    [tokenIndexes.ARB]: 'ARB',
}

const configAddress = {
    // address signer
    deployer: '0x41BC7208d03a38FD6AA29057648019C4e93049b6', // signer1
    proxyAdmin: '0xC2829C12c1Ca8D700A9C94Da66d241E1790a900C',
    linker: '0xc3ec961EECB978bca30A75f9f756bBAB5e36B532',
    keeper: '0xC1442936F623Ae86c45Bd29FeB22f2208A0d9A4B',
    liquidator: '0xE8C342054490501E5dA6a722bE4360F6cadD12BF',

    // fees
    feeReceiver: '0x41c6Ad25a673673A53c6CFA615379C473275D4CA', // execute fee
    mintReceiver: '0xA2cE39faC6201ff9998A43f5f0B57f0908aF7b13',

    // weth
    weth: '0x6c4eE95dfE63b13e6f3FaBd0Cbca81D41FF8f87f', // if not
}

module.exports = { networkId, priceFeedApi, priceFeedSigners, tokenIndexes, symbols, configAddress }
