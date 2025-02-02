const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./Vault/helpers')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')
// const  fs = require("fs")
// const { ethers } = require("hardhat")

use(solidity)

const USD_PRECISION = expandDecimals(1, 30)

describe('PositionManager', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let vaultUtils
    let vaultPriceFeed
    let positionManager
    let musd
    let router
    let bnb
    let btc
    let dai
    let distributor0
    let yieldTracker0
    let orderBook
    let orderBookOpenOrder
    let deployTimeLock
    let miOracle
    let fulfillController

    let milpManager
    let milp

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        dai = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        await vault.setIsLeverageEnabled(false)
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        const initVaultResult = await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        vaultUtils = initVaultResult.vaultUtils

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

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

        orderBook = await deployContract('OrderBook', [])
        orderBookOpenOrder = await deployContract('OrderBookOpenOrder', [orderBook.address, vaultPositionController.address])

        const minExecutionFee = 500000
        await orderBook.initialize(
            router.address,
            vault.address,
            vaultPositionController.address,
            orderBookOpenOrder.address,
            bnb.address,
            musd.address,
            minExecutionFee,
            expandDecimals(5, 30) // minPurchaseTokenAmountUsd
        )
        await router.addPlugin(orderBook.address)
        await router.connect(user0).approvePlugin(orderBook.address)

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        positionManager = await deployContract('PositionManager', [
            vault.address,
            vaultPositionController.address,
            router.address,
            bnb.address,
            50,
            orderBook.address,
        ])

        // set fulfillController
        await fulfillController.setController(wallet.address, true)
        await fulfillController.setHandler(router.address, true)
        await fulfillController.setHandler(positionManager.address, true)
        await fulfillController.setHandler(orderBook.address, true)

        await orderBook.setFulfillController(fulfillController.address)
        await router.setFulfillController(fulfillController.address)
        await positionManager.setFulfillController(fulfillController.address)
        await positionManager.setMaxExecuteOrder(1)
        await orderBook.setOrderExecutor(positionManager.address)

        // set vault
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await bnb.mint(user1.address, expandDecimals(1000, 18))
        await bnb.connect(user1).approve(router.address, expandDecimals(1000, 18))
        await router.connect(user1).swap([bnb.address, musd.address], expandDecimals(1000, 18), expandDecimals(29000, 18), user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await dai.mint(user1.address, expandDecimals(30000, 18))
        await dai.connect(user1).approve(router.address, expandDecimals(30000, 18))
        await router.connect(user1).swap([dai.address, musd.address], expandDecimals(30000, 18), expandDecimals(29000, 18), user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await btc.mint(user1.address, expandDecimals(10, 8))
        await btc.connect(user1).approve(router.address, expandDecimals(10, 8))
        await router.connect(user1).swap([btc.address, musd.address], expandDecimals(10, 8), expandDecimals(59000, 18), user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        deployTimeLock = async () => {
            return await deployContract('TimeLock', [
                wallet.address,
                5 * 24 * 60 * 60,
                ethers.constants.AddressZero,
                ethers.constants.AddressZero,
                ethers.constants.AddressZero,
                expandDecimals(1000, 18),
                10,
                100,
            ])
        }
    })

    it('inits', async () => {
        expect(await positionManager.router(), 'router').eq(router.address)
        expect(await positionManager.vault(), 'vault').eq(vault.address)
        expect(await positionManager.weth(), 'weth').eq(bnb.address)
        expect(await positionManager.depositFee()).eq(50)
        expect(await positionManager.governor(), 'gov').eq(wallet.address)
    })

    it('setDepositFee', async () => {
        await expect(positionManager.connect(user0).setDepositFee(10)).to.be.revertedWith('BasePositionManager: forbidden')

        expect(await positionManager.depositFee()).eq(50)
        await positionManager.connect(wallet).setDepositFee(10)
        expect(await positionManager.depositFee()).eq(10)
    })

    it('approve', async () => {
        await expect(positionManager.connect(user0).approve(bnb.address, user1.address, 10)).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${user0.address}")`
        )

        expect(await bnb.allowance(positionManager.address, user1.address)).eq(0)
        await positionManager.connect(wallet).approve(bnb.address, user1.address, 10)
        expect(await bnb.allowance(positionManager.address, user1.address)).eq(10)
    })

    it('setOrderKeeper', async () => {
        await expect(positionManager.connect(user0).setOrderKeeper(user1.address, true)).to.be.revertedWith('BasePositionManager: forbidden')

        await positionManager.setAdmin(user0.address)

        expect(await positionManager.isOrderKeeper(user1.address)).eq(false)
        await positionManager.connect(user0).setOrderKeeper(user1.address, true)
        expect(await positionManager.isOrderKeeper(user1.address)).eq(true)
    })

    it('setLiquidator', async () => {
        await expect(positionManager.connect(user0).setLiquidator(user1.address, true)).to.be.revertedWith('BasePositionManager: forbidden')

        await positionManager.setAdmin(user0.address)

        expect(await positionManager.isLiquidator(user1.address)).eq(false)
        await positionManager.connect(user0).setLiquidator(user1.address, true)
        expect(await positionManager.isLiquidator(user1.address)).eq(true)
    })

    it('setPartner', async () => {
        await expect(positionManager.connect(user0).setPartner(user1.address, true)).to.be.revertedWith('BasePositionManager: forbidden')

        await positionManager.setAdmin(user0.address)

        expect(await positionManager.isPartner(user1.address)).eq(false)
        await positionManager.connect(user0).setPartner(user1.address, true)
        expect(await positionManager.isPartner(user1.address)).eq(true)
    })

    it('setInLegacyMode', async () => {
        await expect(positionManager.connect(user0).setInLegacyMode(true)).to.be.revertedWith('BasePositionManager: forbidden')

        await positionManager.setAdmin(user0.address)

        expect(await positionManager.inLegacyMode()).eq(false)
        await positionManager.connect(user0).setInLegacyMode(true)
        expect(await positionManager.inLegacyMode()).eq(true)
    })

    it('setShouldValidateIncreaseOrder', async () => {
        await expect(positionManager.connect(user0).setShouldValidateIncreaseOrder(false)).to.be.revertedWith('BasePositionManager: forbidden')

        await positionManager.setAdmin(user0.address)

        expect(await positionManager.shouldValidateIncreaseOrder()).eq(true)
        await positionManager.connect(user0).setShouldValidateIncreaseOrder(false)
        expect(await positionManager.shouldValidateIncreaseOrder()).eq(false)
    })

    it('increasePosition and decreasePosition', async () => {
        const timeLock = await deployTimeLock()

        await expect(
            positionManager.connect(user0).increasePosition([btc.address], btc.address, expandDecimals(1, 7), 0, 0, true, toUsd(100000))
        ).to.be.revertedWith('PositionManager: forbidden')

        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await btc.connect(user0).approve(router.address, expandDecimals(1, 8))
        await btc.mint(user0.address, expandDecimals(3, 8))

        await positionManager.setInLegacyMode(true)

        await expect(
            positionManager.connect(user0).increasePosition([btc.address], btc.address, expandDecimals(1, 7), 0, 0, true, toUsd(100000))
        ).to.be.revertedWith('TimeLock: forbidden')

        // path length should be 1 or 2
        await expect(
            positionManager
                .connect(user0)
                .increasePosition([btc.address, bnb.address, dai.address], btc.address, expandDecimals(1, 7), 0, 0, true, toUsd(100000))
        ).to.be.revertedWith('PositionManager: invalid _path.length')

        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)

        await dai.mint(user0.address, expandDecimals(20000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(20000, 18))

        // too low desired price
        await expect(
            positionManager
                .connect(user0)
                .increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), '332333', toUsd(2000), true, toNormalizedPrice(50000))
        ).to.be.revertedWith('BasePositionManager: mark price higher than limit')

        // too big minOut
        await expect(
            positionManager
                .connect(user0)
                .increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), '1332333', toUsd(2000), true, toNormalizedPrice(60000))
        ).to.be.revertedWith('BasePositionManager: insufficient amountOut')

        await positionManager
            .connect(user0)
            .increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), '332333', toUsd(2000), true, toNormalizedPrice(60000))

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(2000)) // size
        expect(position[1]).eq('197399800000000000000000000000000') // collateral, 197.3998
        expect(position[2]).eq(toNormalizedPrice(60000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq('3333333') // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit)

        // deposit
        // should deduct extra fee
        await positionManager.connect(user0).increasePosition([btc.address], btc.address, '500000', 0, 0, true, toUsd(60000))
        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(2000)) // size
        expect(position[1]).eq('495899800000000000000000000000000') // collateral, 495.8998, 495.8998 - 197.3998 => 298.5, 1.5 for fees
        expect(position[2]).eq(toNormalizedPrice(60000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq('3333333') // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit

        expect(await btc.balanceOf(positionManager.address)).eq(2500) // 2500 / (10**8) * 60000 => 1.5
        await positionManager.approve(btc.address, user1.address, 5000)
        expect(await btc.balanceOf(user2.address)).eq(0)
        await btc.connect(user1).transferFrom(positionManager.address, user2.address, 2500)
        expect(await btc.balanceOf(user2.address)).eq(2500)

        // leverage is decreased because of big amount of collateral
        // should deduct extra fee

        await positionManager.connect(user0).increasePosition([btc.address], btc.address, '500000', 0, toUsd(300), true, toUsd(100000))

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(2300)) // size
        expect(position[1]).eq('794099800000000000000000000000000') // collateral, 794.0998, 794.0998 - 495.8998 => 298.2, 1.5 for collateral fee, 0.3 for size delta fee

        // regular position increase, no extra fee applied
        await positionManager.connect(user0).increasePosition([btc.address], btc.address, '500000', 0, toUsd(1000), true, toUsd(100000))
        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(3300)) // size
        expect(position[1]).eq('1093099800000000000000000000000000') // collateral, 1093.0998, 1093.0998 - 794.0998 => 299, 1.0 for size delta fee

        await positionManager.setInLegacyMode(false)
        await expect(
            positionManager.connect(user0).decreasePosition(btc.address, btc.address, position[1], position[0], true, user0.address, 0)
        ).to.be.revertedWith('PositionManager: forbidden')
        await positionManager.setInLegacyMode(true)

        expect(await btc.balanceOf(user0.address)).to.be.equal('298500000')
        await positionManager.connect(user0).decreasePosition(btc.address, btc.address, position[1], position[0], true, user0.address, 0)
        expect(await btc.balanceOf(user0.address)).to.be.equal('300316333')
        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral

        await positionManager.setInLegacyMode(false)
        await expect(
            positionManager
                .connect(user0)
                .increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), '332333', toUsd(2000), true, toNormalizedPrice(60000))
        ).to.be.revertedWith('PositionManager: forbidden')

        // partners should have access in non-legacy mode, why???
        expect(await positionManager.isPartner(user0.address)).to.be.false
        await positionManager.setPartner(user0.address, true)
        expect(await positionManager.isPartner(user0.address)).to.be.true
        await expect(
            positionManager
                .connect(user0)
                .increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), '332333', toUsd(2000), true, toNormalizedPrice(60000))
        ).to.be.revertedWith('VaultPriceFeed: price expired')
    })

    it('increasePositionETH and decreasePositionETH', async () => {
        const timeLock = await deployTimeLock()

        await expect(
            positionManager.connect(user0).increasePositionETH([bnb.address], bnb.address, 0, 0, true, toUsd(100000), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('PositionManager: forbidden')

        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await positionManager.setInLegacyMode(true)
        await expect(
            positionManager.connect(user0).increasePositionETH([bnb.address], bnb.address, 0, 0, true, toUsd(100000), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('TimeLock: forbidden')

        // path[0] should always be weth
        await expect(
            positionManager.connect(user0).increasePositionETH([btc.address], bnb.address, 0, 0, true, toUsd(100000), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('PositionManager: invalid _path')

        // path length should be 1 or 2
        await expect(
            positionManager
                .connect(user0)
                .increasePositionETH([bnb.address, dai.address, btc.address], bnb.address, 0, 0, true, toUsd(100000), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('PositionManager: invalid _path.length')

        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)

        await dai.mint(user0.address, expandDecimals(20000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(20000, 18))

        // too low desired price
        await expect(
            positionManager.connect(user0).increasePositionETH([bnb.address], bnb.address, 0, toUsd(2000), true, toUsd(200), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('BasePositionManager: mark price higher than limit')

        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(2000), true, toUsd(100000), { value: expandDecimals(1, 18) })
        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(toUsd(2000))
        expect(position[1]).eq('298000000000000000000000000000000')

        // deposit
        // should deduct extra fee
        await positionManager.connect(user0).increasePositionETH([bnb.address], bnb.address, 0, 0, true, toUsd(60000), { value: expandDecimals(1, 18) })
        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(toUsd(2000)) // size
        expect(position[1]).eq('596500000000000000000000000000000') // collateral, 298 + 300 - 1.5 (300 * 0.5%) = 596.5

        expect(await bnb.balanceOf(positionManager.address)).eq(expandDecimals(5, 15)) // 1 * 0.5%

        // leverage is decreased because of big amount of collateral
        // should deduct extra fee
        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(300), true, toUsd(60000), { value: expandDecimals(1, 18) })
        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(toUsd(2300)) // size
        expect(position[1]).eq('894700000000000000000000000000000') // collateral, 596.5 + 300 - 0.3 - 1.5 = 894.7

        // regular position increase, no extra fee applied
        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(1000), true, toUsd(60000), { value: expandDecimals(1, 18) })
        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(toUsd(3300)) // size
        expect(position[1]).eq('1193700000000000000000000000000000') // collateral, 894.7 + 300 - 1 = 1193.7

        await positionManager.setInLegacyMode(false)
        await expect(
            positionManager.connect(user0).decreasePositionETH(bnb.address, bnb.address, position[1], position[0], true, user0.address, 0)
        ).to.be.revertedWith('PositionManager: forbidden')
        await positionManager.setInLegacyMode(true)

        const balanceBefore = await provider.getBalance(user0.address)

        await positionManager.connect(user0).decreasePositionETH(bnb.address, bnb.address, position[1], position[0], true, user0.address, 0)

        const balanceAfter = await provider.getBalance(user0.address)
        expect(balanceAfter.gt(balanceBefore))
        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral

        await positionManager.setInLegacyMode(false)
        await expect(
            positionManager.connect(user0).increasePositionETH([bnb.address], bnb.address, 0, toUsd(1000), true, toUsd(60000), { value: expandDecimals(1, 18) })
        ).to.be.revertedWith('PositionManager: forbidden')

        // partners should have access in non-legacy mode
        expect(await positionManager.isPartner(user0.address)).to.be.false
        await positionManager.setPartner(user0.address, true)
        expect(await positionManager.isPartner(user0.address)).to.be.true
        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(1000), true, toUsd(60000), { value: expandDecimals(1, 18) })
    })

    it('increasePositionETH with swap', async () => {
        const timeLock = await deployTimeLock()

        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await timeLock.setShouldToggleIsLeverageEnabled(true)
        await positionManager.setInLegacyMode(true)
        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address, btc.address], btc.address, 0, toUsd(2000), true, toUsd(60000), { value: expandDecimals(1, 18) })

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(2000)) // size
        expect(position[1]).eq('297100000000000000000000000000000') // collateral, 297.1, 300 - 297.1 => 2.9, 0.9 fee for swap, 2.0 fee for size delta

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address, btc.address], btc.address, 0, 0, true, toUsd(60000), { value: expandDecimals(1, 18) })

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(2000)) // size
        expect(position[1]).eq('594704200000000000000000000000000') // collateral, 594.7042, 594.7042 - 297.1 => 297.6042, 300 - 297.6042 => 2.3958, ~1.5 + 0.9 fee for swap
    })

    it('increasePosition and increasePositionETH to short', async () => {
        const timeLock = await deployTimeLock()

        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await dai.mint(user0.address, expandDecimals(200, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

        await timeLock.setShouldToggleIsLeverageEnabled(true)
        await positionManager.setInLegacyMode(true)

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address, dai.address], btc.address, 0, toUsd(3000), false, 0, { value: expandDecimals(1, 18) })

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(3000))
        expect(position[1]).eq('296100000000000000000000000000000')

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user0).approve(router.address, expandDecimals(1, 8))
        await positionManager.connect(user0).increasePosition([btc.address, dai.address], bnb.address, '500000', 0, toUsd(3000), false, 0)

        position = await vaultPositionController.getPosition(user0.address, dai.address, bnb.address, false)
        expect(position[0]).eq(toUsd(3000))
        expect(position[1]).eq('296100000000000000000000000000000')
    })

    it('decreasePositionAndSwap and decreasePositionAndSwapETH', async () => {
        const timeLock = await deployTimeLock()
        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await positionManager.setInLegacyMode(true)

        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)

        await dai.mint(user0.address, expandDecimals(20000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(20000, 18))

        await bnb.deposit({ value: expandDecimals(10, 18) })

        // BNB Long
        await positionManager
            .connect(user0)
            .increasePosition([dai.address, bnb.address], bnb.address, expandDecimals(200, 18), 0, toUsd(2000), true, toNormalizedPrice(60000))

        let position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(toUsd(2000)) // size

        let params = [
            [bnb.address, dai.address], // path
            bnb.address, // indexToken
            position[1], // collateralDelta
            position[0], // sizeDelta
            true, // isLong
            user0.address, // receiver
            0, // price
        ]

        await positionManager.setInLegacyMode(false)
        await expect(positionManager.connect(user0).decreasePositionAndSwap(...params, expandDecimals(200, 18))).to.be.revertedWith(
            'PositionManager: forbidden'
        )
        await positionManager.setInLegacyMode(true)

        // too high minOut
        await expect(positionManager.connect(user0).decreasePositionAndSwap(...params, expandDecimals(200, 18))).to.be.revertedWith(
            'BasePositionManager: insufficient amountOut'
        )

        // invalid path[0] == path[1]
        await expect(positionManager.connect(user0).decreasePositionAndSwap([bnb.address, bnb.address], ...params.slice(1), 0)).to.be.revertedWith(
            'Vault: invalid tokens'
        )

        // path.length > 2
        await expect(positionManager.connect(user0).decreasePositionAndSwap([bnb.address, dai.address, bnb.address], ...params.slice(1), 0)).to.be.revertedWith(
            'PositionManager: invalid _path.length'
        )

        let daiBalance = await dai.balanceOf(user0.address)
        await positionManager.connect(user0).decreasePositionAndSwap(...params, 0)
        expect(await dai.balanceOf(user0.address)).to.be.equal(daiBalance.add('194813799999999999601'))

        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).eq(0) // size

        // BTC Short

        await positionManager
            .connect(user0)
            .increasePosition([dai.address], btc.address, expandDecimals(200, 18), 0, toUsd(2000), false, toNormalizedPrice(60000))

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(2000)) // size

        params = [
            [dai.address, bnb.address], // path
            btc.address, // indexToken
            position[1], // collateralDelta
            position[0], // sizeDelta
            false, // isLong
            user0.address, // receiver
            toUsd(60000), // price
        ]
        await positionManager.setInLegacyMode(false)
        await expect(positionManager.connect(user0).decreasePositionAndSwapETH(...params, expandDecimals(200, 18))).to.be.revertedWith(
            'PositionManager: forbidden'
        )
        await positionManager.setInLegacyMode(true)

        await expect(positionManager.connect(user0).decreasePositionAndSwapETH(...params, expandDecimals(200, 18))).to.be.revertedWith(
            'BasePositionManager: insufficient amountOut'
        )

        await expect(positionManager.connect(user0).decreasePositionAndSwapETH([dai.address, dai.address], ...params.slice(1), 0)).to.be.revertedWith(
            'PositionManager: invalid _path'
        )

        await expect(
            positionManager.connect(user0).decreasePositionAndSwapETH([dai.address, btc.address, bnb.address], ...params.slice(1), 0)
        ).to.be.revertedWith('PositionManager: invalid _path.length')

        const bnbBalance = await provider.getBalance(user0.address)
        await positionManager.connect(user0).decreasePositionAndSwapETH(...params, 0)
        expect((await provider.getBalance(user0.address)).gt(bnbBalance)).to.be.true

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(0) // size
    })

    it('deposit collateral for shorts', async () => {
        const timeLock = await deployTimeLock()

        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await dai.mint(user0.address, expandDecimals(200, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

        await timeLock.setShouldToggleIsLeverageEnabled(true)
        await positionManager.setInLegacyMode(true)

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address, dai.address], btc.address, 0, toUsd(3000), false, 0, { value: expandDecimals(1, 18) })

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(3000))
        expect(position[1]).eq('296100000000000000000000000000000') // 296.1

        await dai.mint(user0.address, expandDecimals(200, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(200, 18))
        await positionManager.connect(user0).increasePosition([dai.address], btc.address, expandDecimals(200, 18), 0, 0, false, 0)

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(3000))
        expect(position[1]).eq('496100000000000000000000000000000') // 496.1, zero fee for short collateral deposits
    })

    // it("executeSwapOrder", async () => {

    //   await dai.mint(user0.address, expandDecimals(1000, 18))
    //   await dai.connect(user0).approve(router.address, expandDecimals(100, 18))
    //   await orderBook.connect(user0).createSwapOrder(
    //     [dai.address, btc.address],
    //     expandDecimals(100, 18), //amountIn,
    //     0,
    //     expandDecimals(1, 30), // triggerRatio
    //     true,
    //     expandDecimals(1, 17),
    //     false,
    //     false,
    //     {value: expandDecimals(1, 17)}
    //   )
    //   const orderIndex = (await orderBook.swapOrdersIndex(user0.address)) - 1

    //   // await expect(positionManager.connect(user1).executeSwapOrder(user0.address, orderIndex, user1.address))
    //   //   .to.be.revertedWith("PositionManager: forbidden")
    //   await expect(positionManager.connect(user1).executeOrders(user1.address))
    //     .to.be.revertedWith("PositionManager: forbidden")

    //   const balanceBefore = await provider.getBalance(user1.address)
    //   await positionManager.setOrderKeeper(user1.address, true)

    //   // await positionManager.connect(user1).executeSwapOrder(user0.address, orderIndex, user1.address)
    //   await positionManager.connect(user1).executeOrders(user1.address)

    //   expect((await orderBook.swapOrders(user0.address, orderIndex))[0]).to.be.equal(ethers.constants.AddressZero)

    //   const balanceAfter = await provider.getBalance(user1.address)
    //   expect(balanceAfter.gt(balanceBefore)).to.be.true
    // })

    it('executeIncreaseOrder', async () => {
        const timeLock = await deployTimeLock()
        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)
        await positionManager.setInLegacyMode(true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        const executionFee = expandDecimals(1, 17) // 0.1 WETH
        await dai.mint(user0.address, expandDecimals(20000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(20000, 18))

        const createIncreaseOrder = async (amountIn = expandDecimals(1000, 18), sizeDelta = toUsd(2000), isLong = true) => {
            const path = isLong ? [dai.address, btc.address] : [dai.address]
            const collateralToken = isLong ? btc.address : dai.address
            await orderBook.connect(user0).createIncreaseOrder(
                path,
                amountIn,
                btc.address, // indexToken
                0, // minOut
                sizeDelta,
                collateralToken,
                isLong,
                toUsd(59000), // triggerPrice
                true, // triggerAboveThreshold
                executionFee,
                false, // shouldWrap
                { value: executionFee }
            )

            // fulfillRequest for createIncreaseOrderWithSwap
            const tx = await miOracle.fulfillRequest(
                [
                    { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
                ],
                0
            )
        }

        await createIncreaseOrder()

        let orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        expect(await positionManager.isOrderKeeper(user1.address)).to.be.false

        await expect(positionManager.connect(user1).executeOrders(user1.address)).to.be.revertedWith('PositionManager: forbidden')

        const balanceBefore = await provider.getBalance(user1.address)
        await positionManager.setOrderKeeper(user1.address, true)
        expect(await positionManager.isOrderKeeper(user1.address)).to.be.true

        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect((await orderBook.increaseOrders(user0.address, orderIndex))[0]).to.be.equal(ethers.constants.AddressZero)
        const balanceAfter = await provider.getBalance(user1.address)
        expect(balanceAfter.gt(balanceBefore)).to.be.true

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).to.be.equal(toUsd(2000))

        // by default validation is enabled
        expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true

        // should revert on deposits
        await createIncreaseOrder(expandDecimals(100, 18), 0)

        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        const badOrderIndex1 = orderIndex
        await positionManager.connect(user1).executeOrders(user1.address)
        // x revertedWith("PositionManager: long deposit")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // should block if leverage is decreased
        await createIncreaseOrder(expandDecimals(100, 18), toUsd(100))
        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        const badOrderIndex2 = orderIndex

        await positionManager.connect(user1).executeOrders(user1.address)
        // x revertedWith("PositionManager: long deposit")
        // - revertedWith("PositionManager: long leverage decrease")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // should not block if leverage is not decreased
        await createIncreaseOrder()

        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        await positionManager.connect(user1).executeOrders(user1.address)
        // x revertedWith("PositionManager: long deposit")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await positionManager.setShouldValidateIncreaseOrder(false)
        expect(await positionManager.shouldValidateIncreaseOrder()).to.be.false

        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // shorts
        await positionManager.setShouldValidateIncreaseOrder(true)
        expect(await positionManager.shouldValidateIncreaseOrder()).to.be.true

        await createIncreaseOrder(expandDecimals(1000, 18), toUsd(2000), false)
        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // should not block deposits for shorts
        await createIncreaseOrder(expandDecimals(100, 18), 0, false)
        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await createIncreaseOrder(expandDecimals(100, 18), toUsd(100), false)
        orderIndex = (await orderBook.increaseOrdersIndex(user0.address)) - 1
        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )
    })

    it('executeDecreaseOrder', async () => {
        const timeLock = await deployTimeLock()
        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)
        await positionManager.setInLegacyMode(true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(1000), true, toUsd(100000), { value: expandDecimals(1, 18) })

        let position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)

        const executionFee = expandDecimals(1, 17) // 0.1 WETH
        await orderBook.connect(user0).createDecreaseOrder(bnb.address, position[0], bnb.address, position[1], true, toUsd(290), true, { value: executionFee })

        const orderIndex = (await orderBook.decreaseOrdersIndex(user0.address)) - 1
        await expect(positionManager.connect(user1).executeOrders(user1.address)).to.be.revertedWith('PositionManager: forbidden')

        const balanceBefore = await provider.getBalance(user1.address)
        await positionManager.setOrderKeeper(user1.address, true)
        await positionManager.connect(user1).executeOrders(user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect((await orderBook.decreaseOrders(user0.address, orderIndex))[0]).to.be.equal(ethers.constants.AddressZero)
        const balanceAfter = await provider.getBalance(user1.address)
        expect(balanceAfter.gt(balanceBefore)).to.be.true

        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).to.be.equal(0)
    })

    it('liquidatePosition', async () => {
        const timeLock = await deployTimeLock()
        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await timeLock.setContractHandler(positionManager.address, true)
        await timeLock.setShouldToggleIsLeverageEnabled(true)

        expect(await positionManager.isLiquidator(user1.address)).to.be.false
        await expect(positionManager.connect(user1).liquidatePosition(user1.address, bnb.address, bnb.address, true, user0.address)).to.be.revertedWith(
            'PositionManager: forbidden'
        )

        await positionManager.setInLegacyMode(true)
        await router.addPlugin(positionManager.address)
        await router.connect(user0).approvePlugin(positionManager.address)

        await positionManager
            .connect(user0)
            .increasePositionETH([bnb.address], bnb.address, 0, toUsd(1000), true, toUsd(100000), { value: expandDecimals(1, 18) })
        let position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(200), lastUpdate: 0 },
            ],
            0
        )

        await expect(positionManager.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user1.address)).to.be.revertedWith(
            'PositionManager: forbidden'
        )

        await positionManager.setLiquidator(user1.address, true)

        expect(await positionManager.isLiquidator(user1.address)).to.be.true
        await positionManager.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user1.address)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(200), lastUpdate: 0 },
            ],
            0
        )

        position = await vaultPositionController.getPosition(user0.address, bnb.address, bnb.address, true)
        expect(position[0]).to.be.equal(0)
    })
})
