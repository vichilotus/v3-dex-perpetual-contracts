const { deployContract } = require('./fixtures')
const { tokenIndexes } = require('../core/Vault/helpers')

let miOracle
let btcPriceFeed
let ethPriceFeed
let bnbPriceFeed
let usdtPriceFeed
let busdPriceFeed
let usdcPriceFeed
const fulfillFee = 3000 // 30%
const minFeeBalance = 0.02 * 10 ** 9

async function deployMiOracle(weth) {
    miOracle = await deployContract('MiOracleMock', [weth.address])
    btcPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'BTC/USD Price Feed', tokenIndexes.BTC, 8])
    ethPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'ETH/USD Price Feed', tokenIndexes.ETH, 8])
    bnbPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'BNB/USD Price Feed', tokenIndexes.BNB, 8])
    usdtPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'USDT/USD Price Feed', tokenIndexes.USDT, 8])
    busdPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'BUSD/USD Price Feed', tokenIndexes.BUSD, 8])
    usdcPriceFeed = await deployContract('PriceFeedStoreMock', [miOracle.address, 'USDC/USD Price Feed', tokenIndexes.USDC, 8])

    const priceFeedList = [
        btcPriceFeed.address,
        ethPriceFeed.address,
        bnbPriceFeed.address,
        usdtPriceFeed.address,
        busdPriceFeed.address,
        usdcPriceFeed.address,
    ]
    await miOracle.setPriceFeedStore(priceFeedList)

    // set reqFee
    await miOracle.setFulfillFee(fulfillFee)
    await miOracle.setMinFeeBalance(minFeeBalance)

    return miOracle
}

function getPriceFeed() {
    return [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed]
}

module.exports = { deployMiOracle, getPriceFeed }
