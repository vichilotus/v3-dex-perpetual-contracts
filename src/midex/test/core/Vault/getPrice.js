const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed, newWallet } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getDaiConfig, getBnbConfig, getBtcConfig, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.getPrice', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let vaultPriceFeed
    let musd
    let router
    let bnb
    let btc
    let eth
    let dai
    let busd
    let usdc
    let distributor0
    let yieldTracker0
    let fulfillController

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])
        usdc = await deployContract('Token', [])
        busd = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)

        distributor0 = await deployContract('TimeDistributor', [])
        yieldTracker0 = await deployContract('YieldTracker', [musd.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)
        await musd.setYieldTrackers([yieldTracker0.address])

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])
        await fulfillController.setController(wallet.address, true)

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(usdc.address, usdcPriceFeed.address, 8, true)
        await vaultPriceFeed.setTokenConfig(busd.address, busdPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT
    })

    it('getPrice', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getDaiConfig(dai))
        expect(await vaultPriceFeed.getPrice(dai.address, true, true)).eq(expandDecimals(1, 30))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1.1), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(dai.address, true, true)).eq(expandDecimals(11, 29))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(1), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(
            usdc.address, // _token
            18, // _tokenDecimals
            10000, // _tokenWeight
            75, // _minProfitBps,
            0, // _maxMusdAmount
            false, // _isStable
            true // _isShortable
        )

        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(1, 30))
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(1.1), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(11, 29)) // 1.1

        await vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 29))
        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(1, 30))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(1.11), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(111, 28))
        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(1, 30))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(0.9), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(111, 28))
        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(1, 30))

        await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20)
        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(1, 30))

        await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 0)
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(0.89), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(0.89), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(usdc.address, true, true)).eq(expandDecimals(1, 30))
        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(89, 28))

        await vaultPriceFeed.setSpreadBasisPoints(usdc.address, 20)
        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(89, 28))

        expect(await vaultPriceFeed.getPrice(usdc.address, false, true)).eq(expandDecimals(89, 28))

        await vaultPriceFeed.setSpreadBasisPoints(btc.address, 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        expect(await vaultPriceFeed.getPrice(btc.address, true, true)).eq(expandDecimals(40000, 30))

        await vaultPriceFeed.setSpreadBasisPoints(btc.address, 20)
        expect(await vaultPriceFeed.getPrice(btc.address, false, true)).eq(expandDecimals(39920, 30))
    })
})
