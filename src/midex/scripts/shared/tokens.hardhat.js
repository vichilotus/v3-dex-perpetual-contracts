// price feeds https://docs.chain.link/docs/binance-smart-chain-addresses/
const { getContractAddress, expandDecimals } = require('./helpers')

module.exports = {
    btc: {
        name: 'btcFaucet',
        address: getContractAddress('btcFaucet', true),
        priceFeed: getContractAddress('btcPriceFeed', true),
        decimals: 18,
        tokenIndex: 0,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 15000, // 15%
        minProfitBps: 0,
        maxMusdAmount: 150 * 1000 * 1000,
        // bufferAmount: 450,
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
        // bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    bnb: {
        name: 'bnbFaucet',
        address: getContractAddress('bnbFaucet', true),
        priceFeed: getContractAddress('bnbPriceFeed', true),
        decimals: 18,
        tokenIndex: 2,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 10000, // 10%
        minProfitBps: 0,
        maxMusdAmount: 100 * 1000 * 1000,
        // bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    usdt: {
        name: 'usdtFaucet',
        address: getContractAddress('usdtFaucet', true),
        priceFeed: getContractAddress('usdtPriceFeed', true),
        decimals: 18,
        tokenIndex: 3,
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 35000, // 35%
        minProfitBps: 0,
        maxMusdAmount: 350 * 1000 * 1000,
        // bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    usdc: {
        name: 'usdcFaucet',
        address: getContractAddress('usdcFaucet', true),
        decimals: 18,
        priceFeed: getContractAddress('usdcPriceFeed', true),
        priceDecimals: 8,
        isStrictStable: true,
        tokenWeight: 15000, // 15%
        minProfitBps: 0,
        maxMusdAmount: 150 * 1000 * 1000,
        // bufferAmount: 60 * 1000 * 1000,
        isStable: true,
        isShortable: false,
    },
    matic: {
        name: 'maticFaucet',
        address: getContractAddress('maticFaucet', true),
        priceFeed: getContractAddress('maticPriceFeed', true),
        decimals: 18,
        tokenIndex: 1,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        // bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    op: {
        name: 'opFaucet',
        address: getContractAddress('opFaucet', true),
        priceFeed: getContractAddress('opPriceFeed', true),
        decimals: 18,
        tokenIndex: 1,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        // bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    link: {
        name: 'linkFaucet',
        address: getContractAddress('linkFaucet', true),
        priceFeed: getContractAddress('linkPriceFeed', true),
        decimals: 18,
        tokenIndex: 1,
        priceDecimals: 8,
        fastPricePrecision: 1000,
        isStrictStable: false,
        tokenWeight: 5000, // 5%
        minProfitBps: 0,
        maxMusdAmount: 50 * 1000 * 1000,
        // bufferAmount: 15000,
        isStable: false,
        isShortable: true,
        maxGlobalShortSize: 30 * 1000 * 1000,
    },
    nativeToken: {
        address: getContractAddress('nativeToken', true),
        decimals: 18,
        // priceDecimals: 8,
        isStrictStable: false,
    },
}
