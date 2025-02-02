// price feeds https://docs.chain.link/docs/binance-smart-chain-addresses/
const { getContractAddress, expandDecimals } = require('./helpers')

tokenArray = {
    btc: {
        name: 'btc',
        address: getContractAddress('btc', true),
        priceFeed: getContractAddress('btcPriceFeed', true),
        decimals: 18,
        tokenIndex: 0,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 15000, // 15%
        minProfitBps: 0,
        maxMusdAmount: 150 * 1000 * 1000,
        bufferAmount: 450,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    eth: {
        name: 'weth',
        address: getContractAddress('weth', true),
        priceFeed: getContractAddress('ethPriceFeed', true),
        decimals: 18,
        tokenIndex: 1,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    bnb: {
        name: 'bnb',
        address: getContractAddress('bnb', true),
        priceFeed: getContractAddress('bnbPriceFeed', true),
        decimals: 18,
        tokenIndex: 2,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    usdt: {
        name: 'usdt',
        address: getContractAddress('usdt', true),
        priceFeed: getContractAddress('usdtPriceFeed', true),
        decimals: 18,
        tokenIndex: 3,
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 35000, // 35%
        minProfitBps: 0,
        maxMusdAmount: 350 * 1000 * 1000,
        bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    busd: {
        name: 'busd',
        address: getContractAddress('busd', true),
        priceFeed: getContractAddress('busdPriceFeed', true),
        decimals: 18,
        tokenIndex: 4,
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 15000, // 15%
        minProfitBps: 0,
        maxMusdAmount: 150 * 1000 * 1000,
        bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    usdc: {
        name: 'usdc',
        address: getContractAddress('usdc', true),
        priceFeed: getContractAddress('usdcPriceFeed', true),
        decimals: 18,
        tokenIndex: 5,
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 15000, // 15%
        minProfitBps: 0,
        maxMusdAmount: 150 * 1000 * 1000,
        bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    dai: {
        name: 'dai',
        address: getContractAddress('dai', true),
        priceFeed: getContractAddress('daiPriceFeed', true),
        decimals: 18,
        tokenIndex: 6,
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 35000, // 35%
        minProfitBps: 0,
        maxMusdAmount: 350 * 1000 * 1000,
        bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    xrp: {
        name: 'xrp',
        address: getContractAddress('xrp', true),
        priceFeed: getContractAddress('xrpPriceFeed', true),
        decimals: 18,
        tokenIndex: 10,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    doge: {
        name: 'doge',
        address: getContractAddress('doge', true),
        priceFeed: getContractAddress('dogePriceFeed', true),
        decimals: 18,
        tokenIndex: 11,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    trx: {
        name: 'trx',
        address: getContractAddress('trx', true),
        priceFeed: getContractAddress('trxPriceFeed', true),
        decimals: 18,
        tokenIndex: 12,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    ada: {
        name: 'ada',
        address: getContractAddress('ada', true),
        priceFeed: getContractAddress('adaPriceFeed', true),
        decimals: 18,
        tokenIndex: 20,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    matic: {
        name: 'matic',
        address: getContractAddress('matic', true),
        priceFeed: getContractAddress('maticPriceFeed', true),
        decimals: 18,
        tokenIndex: 21,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    sol: {
        name: 'sol',
        address: getContractAddress('sol', true),
        priceFeed: getContractAddress('solPriceFeed', true),
        decimals: 18,
        tokenIndex: 22,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    dot: {
        name: 'dot',
        address: getContractAddress('dot', true),
        priceFeed: getContractAddress('dotPriceFeed', true),
        decimals: 18,
        tokenIndex: 23,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    link: {
        name: 'link',
        address: getContractAddress('link', true),
        priceFeed: getContractAddress('linkPriceFeed', true),
        decimals: 18,
        tokenIndex: 24,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    ftm: {
        name: 'ftm',
        address: getContractAddress('ftm', true),
        priceFeed: getContractAddress('ftmPriceFeed', true),
        decimals: 18,
        tokenIndex: 25,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    near: {
        name: 'near',
        address: getContractAddress('near', true),
        priceFeed: getContractAddress('nearPriceFeed', true),
        decimals: 18,
        tokenIndex: 26,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    atom: {
        name: 'atom',
        address: getContractAddress('atom', true),
        priceFeed: getContractAddress('atomPriceFeed', true),
        decimals: 18,
        tokenIndex: 27,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    op: {
        name: 'op',
        address: getContractAddress('op', true),
        priceFeed: getContractAddress('opPriceFeed', true),
        decimals: 18,
        tokenIndex: 28,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    arb: {
        name: 'arb',
        address: getContractAddress('arb', true),
        priceFeed: getContractAddress('arbPriceFeed', true),
        decimals: 18,
        tokenIndex: 29,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    nativeToken: {
        name: 'nativeToken',
        address: getContractAddress('weth', true),
        priceFeed: getContractAddress('ethPriceFeed', true),
        decimals: 18,
        tokenIndex: 1,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
}

module.exports = { tokenArray }
