const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.increaseShortPosition', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let milpManager
    let vaultPriceFeed
    let milp
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
        milp = await deployContract('MILP', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        const initVaultResult = await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

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

    // it("increasePosition short validations", async () => {
    //   // await bnbPriceFeed.setLatestAnswer(toChainLinkPrice(300))
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BNB, toMiOraclePrice(300), 0)
    //   await vault.setTokenConfig(...getBnbConfig(bnb))
    //   // await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
    //   await expect(vaultPositionController.connect(user1).increasePosition(user0.address, dai.address, btc.address, 0, false))
    //     .to.be.revertedWith("Vault: invalid msg.sender")
    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: _collateralToken not whitelisted")
    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, bnb.address, bnb.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: _collateralToken must be a stableToken")
    //   // await daiPriceFeed.setLatestAnswer(toChainLinkPrice(1))
    //   await increaseBlockTime(provider, 10) // skip blockTime 10 sec
    //   await fulfillController.setPrice(tokenIndexes.USDT, toMiOraclePrice(1), (await getBlockTime(provider)) + 24 * 60 * 60) // set permanent price
    // 	await vault.setTokenConfig(...getDaiConfig(dai))
    //   // await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: _indexToken must not be a stableToken")

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: _indexToken not shortable")

    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(60000))
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(60000), 0)
    //   await vault.setTokenConfig(
    //     btc.address, // _token
    //     8, // _tokenDecimals
    //     10000, // _tokenWeight
    //     75, // _minProfitBps
    //     0, // _maxMusdAmount
    //     false, // _isStable
    //     false // _isShortable
    //   )

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: _indexToken not shortable")

    //   // await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))
    //   await vault.setTokenConfig(...getBtcConfig(btc))

    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(50000))
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(50000), 0)

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: insufficient collateral for fees")
    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, 0, false))
    //     .to.be.revertedWith("Vault: invalid position.size")

    //   await dai.mint(user0.address, expandDecimals(1000, 18))
    //   await dai.connect(user0).transfer(vault.address, expandDecimals(9, 17))

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: insufficient collateral for fees")

    //   await dai.connect(user0).transfer(vault.address, expandDecimals(4, 18))

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
    //     .to.be.revertedWith("Vault: losses exceed collateral")

    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(41000))
    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(41000), 0)
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
    //     .to.be.revertedWith("Vault: liquidation fees exceed collateral")

    //   await dai.connect(user0).transfer(vault.address, expandDecimals(6, 18))

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(8), false))
    //     .to.be.revertedWith("Vault: _size must be more than _collateral")

    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   // await btcPriceFeed.setLatestAnswer(toChainLinkPrice(40000))
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)
    //   await increaseBlockTime(provider, 10)
    //   await fulfillController.setPrice(tokenIndexes.BTC, toMiOraclePrice(40000), 0)

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(600), false))
    //     .to.be.revertedWith("Vault: maxLeverage exceeded")

    //   await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
    //     .to.be.revertedWith("Vault: reserve exceeds pool")
    // })

    it('increasePosition short', async () => {
        await vault.setMaxGlobalShortSize(btc.address, toUsd(300))

        let globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(0)
        expect(await milpManager.getAumInMusd(true)).eq(0)
        expect(await milpManager.getAumInMusd(false)).eq(0)

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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(1000), lastUpdate: 0 }], 0)
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.mint(user0.address, expandDecimals(1000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(500, 18))

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(99), false)).to.be.revertedWith(
            'Vault: _size must be more than _collateral'
        )

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(501), false)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        expect(await vault.feeReserves(dai.address)).eq(0)
        expect(await vault.musdAmounts(dai.address)).eq(0)
        expect(await vault.poolAmounts(dai.address)).eq(0)

        expect(await vault.getRedemptionCollateralUsd(dai.address)).eq(0)
        await vault.buyMUSD(dai.address, user1.address)
        expect(await vault.getRedemptionCollateralUsd(dai.address)).eq('499800000000000000000000000000000')

        expect(await vault.feeReserves(dai.address)).eq('200000000000000000') // 0.2
        expect(await vault.musdAmounts(dai.address)).eq('499800000000000000000') // 499.8
        expect(await vault.poolAmounts(dai.address)).eq('499800000000000000000') // 499.8

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(0)
        expect(await milpManager.getAumInMusd(true)).eq('499800000000000000000')
        expect(await milpManager.getAumInMusd(false)).eq('499800000000000000000')

        await dai.connect(user0).transfer(vault.address, expandDecimals(20, 18))
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(501), false)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        expect(await vault.reservedAmounts(btc.address)).eq(0)
        expect(await vault.guaranteedUsd(btc.address)).eq(0)

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(0) // lastIncreasedTime

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)
        const tx = await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)
        await reportGasUsed(provider, tx, 'increasePosition gas used')

        expect(await vault.poolAmounts(dai.address)).eq('499800000000000000000')
        expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
        expect(await vault.guaranteedUsd(dai.address)).eq(0)
        expect(await vault.getRedemptionCollateralUsd(dai.address)).eq('499800000000000000000000000000000')

        const blockTime = await getBlockTime(provider)

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(19.91)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(blockTime) // lastIncreasedTime

        expect(await vault.feeReserves(dai.address)).eq('290000000000000000') // 0.29
        expect(await vault.musdAmounts(dai.address)).eq('499800000000000000000') // 499.8
        expect(await vault.poolAmounts(dai.address)).eq('499800000000000000000') // 499.8

        expect(await vault.globalShortSizes(btc.address)).eq(toUsd(90))
        expect(await vault.globalShortAveragePrices(btc.address)).eq(toNormalizedPrice(40000))

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(2.25))

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        expect(await milpManager.getAumInMusd(true)).eq('502050000000000000000')
        expect(await milpManager.getAumInMusd(false)).eq('499800000000000000000')

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2.25))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(42000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(42000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(42000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(4.5))

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq(toUsd(4.5))

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        expect(await milpManager.getAumInMusd(true)).eq('504300000000000000000') // 499.8 + 4.5
        expect(await milpManager.getAumInMusd(false)).eq('504300000000000000000') // 499.8 + 4.5

        await vaultPositionController.connect(user0).decreasePosition(user0.address, dai.address, btc.address, toUsd(3), toUsd(50), false, user2.address)

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(14.41)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(40, 18)) // reserveAmount
        expect(position[5]).eq(toUsd(2.5)) // realizedPnl
        expect(position[6]).eq(false) // hasProfit
        expect(position[7]).eq(blockTime) // lastIncreasedTime

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(2))

        expect(await vault.feeReserves(dai.address)).eq('340000000000000000') // 0.18
        expect(await vault.musdAmounts(dai.address)).eq('499800000000000000000') // 499.8
        expect(await vault.poolAmounts(dai.address)).eq('502300000000000000000') // 502.3

        expect(await vault.globalShortSizes(btc.address)).eq(toUsd(40))
        expect(await vault.globalShortAveragePrices(btc.address)).eq('40692041522491349480968858131487889')

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq('1285714285714285714285714285714')

        expect(await milpManager.getAumInMusd(true)).eq('503585714285714285714') // 499.8 + 4.5
        expect(await milpManager.getAumInMusd(false)).eq('503585714285714285714') // 499.8 + 4.5

        await dai.mint(vault.address, expandDecimals(50, 18))
        await vaultPositionController.connect(user1).increasePosition(user1.address, dai.address, btc.address, toUsd(200), false)

        expect(await vault.globalShortSizes(btc.address)).eq(toUsd(240))
        expect(await vault.globalShortAveragePrices(btc.address)).eq('41776198934280639431616341030195431')

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(false)
        expect(await globalDelta[1]).eq('1285714285714285714285714285714')
        expect(await milpManager.getAumInMusd(true)).eq('503585714285714285714') // 502.3 + 2
        expect(await milpManager.getAumInMusd(false)).eq('503585714285714285714') // 502.3 + 2

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(1))

        delta = await vaultPositionController.getPositionDelta(user1.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('4761904761904761904761904761904') // 4.76

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq('4459183673469387755102040816326')

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        expect(await milpManager.getAumInMusd(true)).eq('497840816326530612244') // 502.3 + 1 - 4.76 => 498.53
        expect(await milpManager.getAumInMusd(false)).eq('492095918367346938775') // 492.77619047619047619

        await dai.mint(vault.address, expandDecimals(20, 18))
        await vaultPositionController.connect(user2).increasePosition(user2.address, dai.address, btc.address, toUsd(60), false)

        expect(await vault.globalShortSizes(btc.address)).eq(toUsd(300))
        expect(await vault.globalShortAveragePrices(btc.address)).eq('41408450704225352112676056338028119')

        globalDelta = await vaultPositionController.getGlobalShortDelta(btc.address)
        expect(await globalDelta[0]).eq(true)
        expect(await globalDelta[1]).eq('2959183673469387755102040816326')
        expect(await milpManager.getAumInMusd(true)).eq('499340816326530612244') // 500.038095238095238095
        expect(await milpManager.getAumInMusd(false)).eq('492095918367346938775') // 492.77619047619047619

        await dai.mint(vault.address, expandDecimals(20, 18))

        await expect(vaultPositionController.connect(user2).increasePosition(user2.address, dai.address, btc.address, toUsd(60), false)).to.be.revertedWith(
            'Vault: max shorts exceeded'
        )

        await vaultPositionController.connect(user2).increasePosition(user2.address, dai.address, bnb.address, toUsd(60), false)
    })
})
