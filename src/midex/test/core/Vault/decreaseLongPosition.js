const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.decreaseLongPosition', function () {
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
    let vaultUtils
    let fulfillController

    let milpManager
    let milp

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        dai = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        const { vaultUtils: _vaultUtils } = await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        vaultUtils = _vaultUtils

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

        await vault.setFees(
            50, // _taxBasisPoints
            20, // _stableTaxBasisPoints
            30, // _mintBurnFeeBasisPoints
            30, // _swapFeeBasisPoints
            4, // _stableSwapFeeBasisPoints
            10, // _marginFeeBasisPoints
            toUsd(5), // _liquidationFeeUsd
            60 * 60, // _minProfitTime
            false // _hasDynamicFees
        )

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])
    })

    it('decreasePosition long', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))

        await expect(
            vaultPositionController.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, true, user2.address)
        ).to.be.revertedWith('Vault: invalid msg.sender')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address)
        ).to.be.revertedWith('Vault: empty position')

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        expect(await milpManager.getAumInMusd(false)).eq('99700000000000000000') // 99.7
        expect(await milpManager.getAumInMusd(true)).eq('102192500000000000000') // 102.1925

        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        expect(await milpManager.getAumInMusd(false)).eq('99702400000000000000') // 99.7024
        expect(await milpManager.getAumInMusd(true)).eq('100192710000000000000') // 100.19271

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('2195121951219512195121951219') // ~0.00219512195 USD

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }, // 41000 * 0.75% => 307.5
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('0')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 308), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 308), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 308), lastUpdate: 0 }], 0)
        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('676097560975609756097560975609') // ~0.676 USD

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        // set last price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('2195121951219512195121951219512') // ~2.1951

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(46100), lastUpdate: 0 }], 0)

        // set last price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('2195121951219512195121951219512') // ~2.1951

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        // set last price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(90817) // ~9X leverage

        // reset price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(46100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(100), true, user2.address)
        ).to.be.revertedWith('Vault: position size exceeded')

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(8.91), toUsd(50), true, user2.address)
        ).to.be.revertedWith('Vault: liquidation fees exceed collateral')

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        expect(await milpManager.getAumInMusd(false)).eq('102202981000000000000') // 102.202981
        expect(await milpManager.getAumInMusd(true)).eq('103183601000000000000') // 103.183601

        const tx = await vaultPositionController
            .connect(user0)
            .decreasePosition(user0.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user2.address)
        await reportGasUsed(provider, tx, 'decreasePosition gas used')

        expect(await milpManager.getAumInMusd(false)).eq('103917746000000000000') // 103.917746
        expect(await milpManager.getAumInMusd(true)).eq('107058666000000000000') // 107.058666

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(57887) // ~5.8X leverage

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq((225000 / 90) * 40) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5]).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await vault.feeReserves(btc.address)).eq(969 + 106) // 0.00000106 * 45100 => ~0.05 USD
        expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(33.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 16878 - 106 - 1)
        expect(await btc.balanceOf(user2.address)).eq(16878) // 0.00016878 * 47100 => 7.949538 USD

        await validateVaultBalance(expect, vault, btc, 1)
    })

    it('decreasePosition long aum', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await bnb.mint(vault.address, expandDecimals(10, 18))
        await vault.buyMUSD(bnb.address, user1.address)

        expect(await milpManager.getAumInMusd(false)).eq('4985000000000000000000') // 4985
        expect(await milpManager.getAumInMusd(true)).eq('4985000000000000000000') // 4985

        await bnb.mint(vault.address, expandDecimals(1, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, bnb.address, bnb.address, toUsd(1000), true)

        expect(await milpManager.getAumInMusd(false)).eq('4985000000000000000000') // 4985
        expect(await milpManager.getAumInMusd(true)).eq('4985000000000000000000') // 4985

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(750), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(750), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(750), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('7227000000000000000000') // 7227
        expect(await milpManager.getAumInMusd(true)).eq('7227000000000000000000') // 7227

        await vaultPositionController.connect(user0).decreasePosition(user0.address, bnb.address, bnb.address, toUsd(0), toUsd(500), true, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('7227000000000000000250') // 7227.00000000000000025
        expect(await milpManager.getAumInMusd(true)).eq('7227000000000000000250') // 7227.00000000000000025

        await vaultPositionController.connect(user0).decreasePosition(user0.address, bnb.address, bnb.address, toUsd(250), toUsd(100), true, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('7227000000000000000250') // 7227.00000000000000025
        expect(await milpManager.getAumInMusd(true)).eq('7227000000000000000250') // 7227.00000000000000025
    })

    it('decreasePosition long minProfitBasisPoints', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))

        await expect(
            vaultPositionController.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, true, user2.address)
        ).to.be.revertedWith('Vault: invalid msg.sender')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address)
        ).to.be.revertedWith('Vault: empty position')

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        // test that minProfitBasisPoints works as expected
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 - 1), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('2195121951219512195121951219') // ~0.00219512195 USD

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }, // 41000 * 0.75% => 307.5
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000 + 307), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('0')

        await increaseTime(provider, 50 * 60 - 60)
        await mineBlock(provider)
        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT], 10, 3)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('0')

        await increaseTime(provider, 10 * 60 + 10)
        await mineBlock(provider)
        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT], 10, 3)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('673902439024390243902439024390') // 0.67390243902
    })

    it('decreasePosition long with loss', async () => {
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
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40790), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40690), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40590), lastUpdate: 0 }], 0)

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(0.9))

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(4), toUsd(50), true, user2.address)
        ).to.be.revertedWith('liquidation fees exceed collateral')

        const tx = await vaultPositionController
            .connect(user0)
            .decreasePosition(user0.address, btc.address, btc.address, toUsd(0), toUsd(50), true, user2.address)
        await reportGasUsed(provider, tx, 'decreasePosition gas used')

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.36)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(100000) // reserveAmount, 0.00100 * 40,000 => 40
        expect(position[5]).eq(toUsd(0.5)) // pnl
        expect(position[6]).eq(false)

        expect(await vault.feeReserves(btc.address)).eq(969 + 122) // 0.00000122 * 40790 => ~0.05 USD
        expect(await vault.reservedAmounts(btc.address)).eq(100000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(30.64))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 122)
        expect(await btc.balanceOf(user2.address)).eq(0)

        await vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(0), toUsd(40), true, user2.address)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // pnl
        expect(position[6]).eq(true)

        expect(await vault.feeReserves(btc.address)).eq(969 + 122 + 98) // 0.00000098 * 40790 => ~0.04 USD
        expect(await vault.reservedAmounts(btc.address)).eq(0)
        expect(await vault.guaranteedUsd(btc.address)).eq(0)
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 122 - 98 - 21868)
        expect(await btc.balanceOf(user2.address)).eq(21868) // 0.00021868 * 40790 => ~8.92 USD

        await validateVaultBalance(expect, vault, btc)
    })
})
