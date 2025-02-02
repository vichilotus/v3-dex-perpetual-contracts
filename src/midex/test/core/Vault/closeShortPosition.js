const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.closeShortPosition', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let vaultPriceFeed
    let musd
    let router
    let bnb
    let btc
    let dai
    let distributor0
    let yieldTracker0
    let fulfillController

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        dai = await deployContract('Token', [])

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
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT
    })

    it('close short position', async () => {
        await vault.setFees(
            50, // _taxBasisPoints
            10, // _stableTaxBasisPoints
            4, // _mintBurnFeeBasisPoints
            30, // _swapFeeBasisPoints
            4, // _stableSwapFeeBasisPoints
            10, // _marginFeeBasisPoints
            toUsd(5), // _liquidationFeeUsd
            0, // _minProfitTime
            false // _hasDynamicFees
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await dai.mint(user0.address, expandDecimals(1000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(100, 18))
        await vault.buyMUSD(dai.address, user1.address)
        expect(await vault.feeReserves(dai.address)).eq('40000000000000000') // 0.04

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount
        expect(position[5]).eq(0) // pnl
        expect(position[6]).eq(true) // hasRealizedProfit

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, dai.address, btc.address, false)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(dai.address)).eq('130000000000000000') // 0.13, 0.04 + 0.09
        expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
        expect(await vault.guaranteedUsd(dai.address)).eq(0)
        expect(await vault.poolAmounts(dai.address)).eq('99960000000000000000') // 99.96
        expect(await dai.balanceOf(user2.address)).eq(0)

        const tx = await vaultPositionController
            .connect(user0)
            .decreasePosition(user0.address, dai.address, btc.address, toUsd(3), toUsd(90), false, user2.address)
        await reportGasUsed(provider, tx, 'decreasePosition gas used')

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // pnl
        expect(position[6]).eq(true) // hasRealizedProfit

        expect(await vault.feeReserves(dai.address)).eq('220000000000000000') // 0.22, 0.04 + 0.09 + 0.09
        expect(await vault.reservedAmounts(dai.address)).eq(0)
        expect(await vault.guaranteedUsd(dai.address)).eq(0)
        expect(await vault.poolAmounts(dai.address)).eq('90960000000000000000') // 90.96
        expect(await dai.balanceOf(user2.address)).eq('18820000000000000000') // 18.82
    })

    it('close short position with loss', async () => {
        await vault.setFees(
            50, // _taxBasisPoints
            10, // _stableTaxBasisPoints
            4, // _mintBurnFeeBasisPoints
            30, // _swapFeeBasisPoints
            4, // _stableSwapFeeBasisPoints
            10, // _marginFeeBasisPoints
            toUsd(5), // _liquidationFeeUsd
            0, // _minProfitTime
            false // _hasDynamicFees
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await dai.mint(user0.address, expandDecimals(1000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(100, 18))
        await vault.buyMUSD(dai.address, user1.address)
        expect(await vault.feeReserves(dai.address)).eq('40000000000000000') // 0.04

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount
        expect(position[5]).eq(0) // pnl
        expect(position[6]).eq(true) // hasRealizedProfit

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('2250000000000000000000000000000') // 2.25

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, dai.address, btc.address, false)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(dai.address)).eq('130000000000000000') // 0.13, 0.04 + 0.09
        expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
        expect(await vault.guaranteedUsd(dai.address)).eq(0)
        expect(await vault.poolAmounts(dai.address)).eq('99960000000000000000') // 99.96
        expect(await dai.balanceOf(user2.address)).eq(0)

        const tx = await vaultPositionController
            .connect(user0)
            .decreasePosition(user0.address, dai.address, btc.address, toUsd(3), toUsd(90), false, user2.address)
        await reportGasUsed(provider, tx, 'decreasePosition gas used')

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // pnl
        expect(position[6]).eq(true) // hasRealizedProfit

        expect(await vault.feeReserves(dai.address)).eq('220000000000000000') // 0.22, 0.04 + 0.09 + 0.09
        expect(await vault.reservedAmounts(dai.address)).eq(0)
        expect(await vault.guaranteedUsd(dai.address)).eq(0)
        expect(await vault.poolAmounts(dai.address)).eq('102210000000000000000') // 102.21
        expect(await dai.balanceOf(user2.address)).eq('7570000000000000000') // 7.57
    })
})
