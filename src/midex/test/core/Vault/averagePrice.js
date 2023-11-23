const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getEthConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.averagePrice', function () {
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
        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        const initVaultResult = await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)

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
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
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

    it('position.averagePrice, buyPrice != markPrice', async () => {
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
        let blockTime = await getBlockTime(provider)

        expect(await milpManager.getAumInMusd(false)).eq('99702400000000000000') // 99.7024
        expect(await milpManager.getAumInMusd(true)).eq('100192710000000000000') // 100.19271

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90
        expect(position[7]).eq(blockTime)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(46100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        // set last price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('102202981000000000000') // 102.202981
        expect(await milpManager.getAumInMusd(true)).eq('103183601000000000000') // 103.183601

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        await increaseTime(provider, 10 * 60 - 30)
        await mineBlock(provider)

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT], 10, 3)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)
        blockTime = await getBlockTime(provider)

        expect(await milpManager.getAumInMusd(false)).eq('102203938000000000000') // 102.203938
        expect(await milpManager.getAumInMusd(true)).eq('102740698000000000000') // 102.740698

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq(toUsd(9.9)) // collateral, 10 - 90 * 0.1% - 10 * 0.1%
        expect(position[2]).eq('43211009174311926605504587155963302') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000 + 22172) // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10
        expect(position[7]).eq(blockTime)

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(101010) // ~10X leverage

        expect(await vault.feeReserves(btc.address)).eq(969 + 21) // 0.00000021 * 45100 => 0.01 USD
        expect(await vault.reservedAmounts(btc.address)).eq(225000 + 22172)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(90.1))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 21)
        expect(await btc.balanceOf(user2.address)).eq(0)

        // profits will decrease slightly as there is a difference between the buy price and the mark price
        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('4371549893842887473460721868365') // ~4.37

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(47100), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        await validateVaultBalance(expect, vault, btc)
    })

    it('position.averagePrice, buyPrice == markPrice', async () => {
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

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(45100), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('102202981000000000000') // 102.202981
        expect(await milpManager.getAumInMusd(true)).eq('102202981000000000000') // 102.202981

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        expect(await milpManager.getAumInMusd(false)).eq('102203487000000000000') // 102.203487
        expect(await milpManager.getAumInMusd(true)).eq('102203487000000000000') // 102.203487

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq(toUsd(9.9)) // collateral, 10 - 90 * 0.1% - 10 * 0.1%
        expect(position[2]).eq('41376146788990825688073394495412844') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000 + 22172) // reserveAmount, 0.00225 * 40,000 => 90, 0.00022172 * 45100 => ~10

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(101010) // ~10X leverage

        expect(await vault.feeReserves(btc.address)).eq(969 + 22) // 0.00000021 * 45100 => 0.01 USD
        expect(await vault.reservedAmounts(btc.address)).eq(225000 + 22172)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(90.1))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 22)
        expect(await btc.balanceOf(user2.address)).eq(0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(9))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('909090909090909090909090909090') // ~0.909

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('20842572062084257206208425720620') // ~20.84
        // 909090909090909090909090909090
        await validateVaultBalance(expect, vault, btc)
    })

    it('position.averagePrice, buyPrice < averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36900), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36900), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(36900), lastUpdate: 0 }], 0)

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(90817) // ~9X leverage

        expect(await vault.feeReserves(btc.address)).eq(969)
        expect(await vault.reservedAmounts(btc.address)).eq(225000)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
        expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
        expect(await btc.balanceOf(user2.address)).eq(0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(9))

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)).to.be.revertedWith(
            'Vault: liquidation fees exceed collateral'
        )

        await btc.connect(user1).transfer(vault.address, 25000)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq(toUsd(9.91 + 9.215)) // collateral, 0.00025 * 36900 => 9.225, 0.01 fees
        expect(position[2]).eq('40549450549450549450549450549450549') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000 + 27100) // reserveAmount, 0.000271 * 36900 => ~10

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(52287) // ~5.2X leverage

        expect(await vault.feeReserves(btc.address)).eq(969 + 27) // 0.00000027 * 36900 => 0.01 USD
        expect(await vault.reservedAmounts(btc.address)).eq(225000 + 27100)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.875))
        expect(await vault.poolAmounts(btc.address)).eq(274250 + 25000 - 219 - 27)
        expect(await btc.balanceOf(user2.address)).eq(0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('8999999999999999999999999999999')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('1111111111111111111111111111111') // ~1.111

        await validateVaultBalance(expect, vault, btc)
    })

    it('long position.averagePrice, buyPrice == averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(0)

        await btc.connect(user1).transfer(vault.address, 25000)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq(toUsd(9.91 + 9.99)) // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000 + 25000) // reserveAmount

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(0)

        await validateVaultBalance(expect, vault, btc)
    })

    it('long position.averagePrice, buyPrice > averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(22.5))

        await btc.connect(user1).transfer(vault.address, 25000)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[2]).eq('40816326530612244897959183673469387') // averagePrice

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(22.5))

        await validateVaultBalance(expect, vault, btc)
    })

    it('long position.averagePrice, buyPrice < averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 125000) // 0.000125 BTC => 50 USD
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(22.5))

        await btc.connect(user1).transfer(vault.address, 25000)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[2]).eq('38709677419354838709677419354838709') // averagePrice

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('22499999999999999999999999999999')
    })

    it('long position.averagePrice, buyPrice < averagePrice + minProfitBasisPoints', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.mint(user1.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
        await vault.buyMUSD(btc.address, user1.address)

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user1).transfer(vault.address, 125000) // 0.000125 BTC => 50 USD
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40300), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40300), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40300), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('0')

        await btc.connect(user1).transfer(vault.address, 25000)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(10), true)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[2]).eq(toUsd(40300)) // averagePrice

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('0')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('1736972704714640198511166253101') // (700 / 40300) * 100 => 1.73697
    })

    it('short position.averagePrice, buyPrice == averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.mint(user1.address, expandDecimals(101, 18))
        await dai.connect(user1).transfer(vault.address, expandDecimals(101, 18))
        await vault.buyMUSD(dai.address, user1.address)

        await dai.mint(user0.address, expandDecimals(50, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(50, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(0)

        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(10), false)

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq('49900000000000000000000000000000') // collateral
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(100, 18)) // reserveAmount

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(0)
    })

    it('short position.averagePrice, buyPrice > averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.mint(user1.address, expandDecimals(101, 18))
        await dai.connect(user1).transfer(vault.address, expandDecimals(101, 18))
        await vault.buyMUSD(dai.address, user1.address)

        await dai.mint(user0.address, expandDecimals(50, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(50, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        expect(await milpManager.getAumInMusd(false)).eq('100697000000000000000') // 100.697
        expect(await milpManager.getAumInMusd(true)).eq('100697000000000000000') // 100.697

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('123197000000000000000') // 123.197
        expect(await milpManager.getAumInMusd(true)).eq('123197000000000000000') // 123.197

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('22500000000000000000000000000000') // 22.5

        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(10), false)

        expect(await milpManager.getAumInMusd(false)).eq('123197000000000000000') // 123.197
        expect(await milpManager.getAumInMusd(true)).eq('123197000000000000000') // 123.197

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq('49900000000000000000000000000000') // collateral
        expect(position[2]).eq('40816326530612244897959183673469387') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(100, 18)) // reserveAmount

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('22500000000000000000000000000000') // 22.5
    })

    it('short position.averagePrice, buyPrice < averagePrice', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.mint(user1.address, expandDecimals(101, 18))
        await dai.connect(user1).transfer(vault.address, expandDecimals(101, 18))
        await vault.buyMUSD(dai.address, user1.address)

        await dai.mint(user0.address, expandDecimals(50, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(50, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        expect(await milpManager.getAumInMusd(false)).eq('100697000000000000000') // 100.697
        expect(await milpManager.getAumInMusd(true)).eq('100697000000000000000') // 100.697

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(30000), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('78197000000000000000') // 78.197
        expect(await milpManager.getAumInMusd(true)).eq('78197000000000000000') // 78.197

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('22500000000000000000000000000000') // 22.5

        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(10), false)

        expect(await milpManager.getAumInMusd(false)).eq('78197000000000000000') // 78.197
        expect(await milpManager.getAumInMusd(true)).eq('78197000000000000000') // 78.197

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq('49900000000000000000000000000000') // collateral
        expect(position[2]).eq('38709677419354838709677419354838709') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(100, 18)) // reserveAmount

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('22499999999999999999999999999999') // ~22.5
    })

    it('short position.averagePrice, buyPrice < averagePrice - minProfitBasisPoints', async () => {
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
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await dai.mint(user1.address, expandDecimals(101, 18))
        await dai.connect(user1).transfer(vault.address, expandDecimals(101, 18))
        await vault.buyMUSD(dai.address, user1.address)

        await dai.mint(user0.address, expandDecimals(50, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(50, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

        expect(await milpManager.getAumInMusd(false)).eq('100697000000000000000') // 100.697
        expect(await milpManager.getAumInMusd(true)).eq('100697000000000000000') // 100.697

        let position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(90)) // size
        expect(position[1]).eq('49910000000000000000000000000000') // collateral, 50 - 90 * 0.1%
        expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(90, 18))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39700), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39700), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39700), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('100022000000000000000') // 100.022
        expect(await milpManager.getAumInMusd(true)).eq('100022000000000000000') // 100.022

        let delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('0') // 22.5

        await vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(10), false)

        expect(await milpManager.getAumInMusd(false)).eq('100022000000000000000') // 100.022
        expect(await milpManager.getAumInMusd(true)).eq('100022000000000000000') // 100.022

        position = await vaultPositionController.getPosition(user0.address, dai.address, btc.address, false)
        expect(position[0]).eq(toUsd(100)) // size
        expect(position[1]).eq('49900000000000000000000000000000') // collateral
        expect(position[2]).eq(toUsd(39700)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(expandDecimals(100, 18)) // reserveAmount

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('0') // ~22.5

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(39000), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('98270677581863979848') // 98.270677581863979848
        expect(await milpManager.getAumInMusd(true)).eq('98270677581863979848') // 98.270677581863979848

        delta = await vaultPositionController.getPositionDelta(user0.address, dai.address, btc.address, false)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq('1763224181360201511335012594458') // (39700 - 39000) / 39700 * 100 => 1.7632
    })

    it('long position.averagePrice, buyPrice < averagePrice', async () => {
        await increaseBlockTime(provider, 30)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '251382560787', lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getEthConfig(eth))

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '252145037536', lastUpdate: 0 }], 0)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '252145037536', lastUpdate: 0 }], 0)

        await eth.mint(user1.address, expandDecimals(10, 18))
        await eth.connect(user1).transfer(vault.address, expandDecimals(10, 18))
        await vault.buyMUSD(eth.address, user1.address)

        await eth.mint(user0.address, expandDecimals(1, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, eth.address, eth.address, '5050322181222357947081599665915068', true)

        let position = await vaultPositionController.getPosition(user0.address, eth.address, eth.address, true)
        expect(position[0]).eq('5050322181222357947081599665915068') // size
        expect(position[1]).eq('2508775285688777642052918400334084') // averagePrice
        expect(position[2]).eq('2521450375360000000000000000000000') // averagePrice
        expect(position[3]).eq(0) // entryFundingRate

        await increaseBlockTime(provider, 30)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '237323502539', lastUpdate: 0 }], 0)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '237323502539', lastUpdate: 0 }], 0)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: '237323502539', lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, eth.address, eth.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq('296866944860754376482796517102673')

        await eth.mint(user0.address, expandDecimals(1, 18))
        await eth.connect(user0).transfer(vaultPositionController.address, expandDecimals(1, 18))
        await vaultPositionController.connect(user0).increasePosition(user0.address, eth.address, eth.address, '4746470050780000000000000000000000', true)

        position = await vaultPositionController.getPosition(user0.address, eth.address, eth.address, true)
        expect(position[0]).eq('9796792232002357947081599665915068') // size
        expect(position[2]).eq('2447397190894361457116367555285124') // averagePrice
    })
})