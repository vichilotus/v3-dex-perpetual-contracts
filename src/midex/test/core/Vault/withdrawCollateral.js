const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.withdrawCollateral', function () {
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

        const _ = await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)

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

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])
    })

    it('withdraw collateral', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setManager(user3.address, true)

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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(46100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        const tx0 = await vaultPositionController
            .connect(user0)
            .decreasePosition(user0.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user2.address)
        await reportGasUsed(provider, tx0, 'decreasePosition gas used')

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
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 219)
        expect(await btc.balanceOf(user2.address)).eq(16878) // 0.00016878 * 47100 => 7.949538 USD

        await expect(
            vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(3), 0, true, user2.address)
        ).to.be.revertedWith('Vault: liquidation fees exceed collateral')

        const tx1 = await vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(1), 0, true, user2.address)
        await reportGasUsed(provider, tx1, 'withdraw collateral gas used')

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(40)) // size
        expect(position[1]).eq(toUsd(9.91 - 3 - 1)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq((225000 / 90) * 40) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[5]).eq(toUsd(5)) // pnl
        expect(position[6]).eq(true)

        expect(await vault.feeReserves(btc.address)).eq(969 + 106) // 0.00000106 * 45100 => ~0.05 USD
        expect(await vault.reservedAmounts(btc.address)).eq((225000 / 90) * 40)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(34.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1 - 2123 - 219) // 0.00002123* 47100 => 1 USD
        expect(await btc.balanceOf(user2.address)).eq(16878 + 2123)

        await btc.mint(user3.address, expandDecimals(2, 8))
        await btc.connect(user3).transfer(vault.address, 2500) // 0.0025 BTC => 1 USD
        await vault.buyMUSD(btc.address, user3.address)
        await expect(vaultPositionController.connect(user3).increasePosition(user3.address, btc.address, btc.address, toUsd(1), true)).to.be.revertedWith(
            'Vault: insufficient collateral for fees'
        )

        position = await vaultPositionController.getPosition(user3.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(0)) //size
        await expect(vaultPositionController.connect(user3).accumulatePosition(user3.address, btc.address, btc.address, true)).to.be.revertedWith(
            'Vault: empty position'
        )
        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(40)) // sizeF
        await vault.connect(user0).addRouter(user3.address)
        await vaultPositionController.connect(user3).accumulatePosition(user0.address, btc.address, btc.address, true)
        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(10160))
    })

    it('withdraw during coolDown duration', async () => {
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

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(46100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        // it's okay to withdraw AND decrease size with at least same proportion (e.g. if leverage is decreased or the same)
        await vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(1), toUsd(10), true, user2.address)

        // it's also okay to fully close position
        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        await vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, position[1], position[0], true, user2.address)

        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(30), true)
    })

    it('withdraw collateral long', async () => {
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
        await vaultPositionController.connect(user0).increasePosition(user0.address, bnb.address, bnb.address, toUsd(2000), true)

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

        expect(await milpManager.getAumInMusd(false)).eq('6726500000000000000000') // 6726.5
        expect(await milpManager.getAumInMusd(true)).eq('6726500000000000000000') // 6726.5

        await bnb.mint(vault.address, expandDecimals(1, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, bnb.address, bnb.address, toUsd(0), true)

        expect(await milpManager.getAumInMusd(false)).eq('6726500000000000000000') // 6726.5
        expect(await milpManager.getAumInMusd(true)).eq('6726500000000000000000') // 6726.5

        await vaultPositionController.connect(user0).decreasePosition(user0.address, bnb.address, bnb.address, toUsd(500), toUsd(0), true, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('6726500000000000000500') // 6726.5000000000000005
        expect(await milpManager.getAumInMusd(true)).eq('6726500000000000000500') // 6726.5000000000000005

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('4171733333333333333600') // 4171.7333333333333336
        expect(await milpManager.getAumInMusd(true)).eq('4171733333333333333600') // 4171.7333333333333336

        await vaultPositionController.connect(user0).decreasePosition(user0.address, bnb.address, bnb.address, toUsd(250), toUsd(0), true, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('4171733333333333333600') // 4171.7333333333333336
        expect(await milpManager.getAumInMusd(true)).eq('4171733333333333333600') // 4171.7333333333333336

        await vaultPositionController.connect(user0).decreasePosition(user0.address, bnb.address, bnb.address, toUsd(0), toUsd(250), true, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('4171733333333333333600') // 4171.7333333333333336
        expect(await milpManager.getAumInMusd(true)).eq('4171733333333333333600') // 4171.7333333333333336
    })

    it('withdraw collateral short', async () => {
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

        await dai.mint(vault.address, expandDecimals(8000, 18))
        await vault.buyMUSD(dai.address, user1.address)

        expect(await milpManager.getAumInMusd(false)).eq('7976000000000000000000') // 7976
        expect(await milpManager.getAumInMusd(true)).eq('7976000000000000000000') // 7976

        await dai.mint(vault.address, expandDecimals(500, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, bnb.address, toUsd(2000), false)

        expect(await milpManager.getAumInMusd(false)).eq('7976000000000000000000') // 7976
        expect(await milpManager.getAumInMusd(true)).eq('7976000000000000000000') // 7976

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(525), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(525), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(525), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('8076000000000000000000') // 8076
        expect(await milpManager.getAumInMusd(true)).eq('8076000000000000000000') // 8076

        await dai.mint(vault.address, expandDecimals(500, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, bnb.address, toUsd(0), false)

        expect(await milpManager.getAumInMusd(false)).eq('8076000000000000000000') // 8076
        expect(await milpManager.getAumInMusd(true)).eq('8076000000000000000000') // 8076

        await vaultPositionController.connect(user0).decreasePosition(user0.address, dai.address, bnb.address, toUsd(500), toUsd(0), false, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('8076000000000000000000') // 8076
        expect(await milpManager.getAumInMusd(true)).eq('8076000000000000000000') // 8076

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(475), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(475), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(475), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('7876000000000000000000') // 7876
        expect(await milpManager.getAumInMusd(true)).eq('7876000000000000000000') // 7876

        await vaultPositionController.connect(user0).decreasePosition(user0.address, dai.address, bnb.address, toUsd(0), toUsd(500), false, user2.address)

        expect(await milpManager.getAumInMusd(false)).eq('7891000000000000000000') // 7876
        expect(await milpManager.getAumInMusd(true)).eq('7891000000000000000000') // 7876
    })
})
