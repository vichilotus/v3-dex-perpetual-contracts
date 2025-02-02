const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.increaseLongPosition', function () {
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
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])
    })

    it('increasePosition long validations', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setMaxGasPrice('20000000000') // 20 gwei
        await vault.setTokenConfig(...getDaiConfig(dai))
        await expect(vaultPositionController.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true)).to.be.revertedWith(
            'Vault: invalid msg.sender'
        )
        await expect(
            vaultPositionController.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true, { gasPrice: '21000000000' })
        ).to.be.revertedWith('Vault: maxGasPrice exceeded')
        await vault.setMaxGasPrice(0)
        await vault.setIsLeverageEnabled(false)
        await expect(
            vaultPositionController.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true, { gasPrice: '21000000000' })
        ).to.be.revertedWith('Vault: leverage not enabled')
        await vault.setIsLeverageEnabled(true)
        await vault.connect(user0).addRouter(user1.address)
        await expect(vaultPositionController.connect(user1).increasePosition(user0.address, btc.address, bnb.address, 0, true)).to.be.revertedWith(
            'Vault: mismatched tokens'
        )
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, bnb.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: mismatched tokens'
        )
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: _collateralToken must not be a stableToken'
        )
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: _collateralToken not whitelisted'
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: insufficient collateral for fees'
        )
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true)).to.be.revertedWith(
            'Vault: invalid position.size'
        )

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user0).transfer(vault.address, 2500 - 1)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: insufficient collateral for fees'
        )

        await btc.connect(user0).transfer(vault.address, 1)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: losses exceed collateral'
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: fees exceed collateral'
        )

        await btc.connect(user0).transfer(vault.address, 10000)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true)).to.be.revertedWith(
            'Vault: liquidation fees exceed collateral'
        )

        await btc.connect(user0).transfer(vault.address, 10000)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(500), true)).to.be.revertedWith(
            'Vault: maxLeverage exceeded'
        )

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(8), true)).to.be.revertedWith(
            'Vault: _size must be more than _collateral'
        )

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )
    })

    it('increasePosition long', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await btc.mint(user0.address, expandDecimals(1, 8))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(41000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(40000), lastUpdate: 0 }], 0)

        await btc.connect(user0).transfer(vault.address, 117500 - 1) // 0.001174 BTC => 47

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(118), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        expect(await vault.feeReserves(btc.address)).eq(0)
        expect(await vault.musdAmounts(btc.address)).eq(0)
        expect(await vault.poolAmounts(btc.address)).eq(0)

        expect(await milpManager.getAumInMusd(true)).eq(0)
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
        await vault.buyMUSD(btc.address, user1.address)
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd('46.8584'))
        expect(await milpManager.getAumInMusd(true)).eq('48029860000000000000') // 48.02986
        expect(await milpManager.getAumInMusd(false)).eq('46858400000000000000') // 46.8584

        expect(await vault.feeReserves(btc.address)).eq(353) // (117500 - 1) * 0.3% => 353
        expect(await vault.musdAmounts(btc.address)).eq('46858400000000000000') // (117500 - 1 - 353) * 40000
        expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353)

        await btc.connect(user0).transfer(vault.address, 117500 - 1)
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(200), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vault.buyMUSD(btc.address, user1.address)

        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd('93.7168'))
        expect(await milpManager.getAumInMusd(true)).eq('96059720000000000000') // 96.05972
        expect(await milpManager.getAumInMusd(false)).eq('93716800000000000000') // 93.7168

        expect(await vault.feeReserves(btc.address)).eq(353 * 2) // (117500 - 1) * 0.3% * 2
        expect(await vault.musdAmounts(btc.address)).eq('93716800000000000000') // (117500 - 1 - 353) * 40000 * 2
        expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2)

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)).to.be.revertedWith(
            'Vault: insufficient collateral for fees'
        )

        await btc.connect(user0).transfer(vault.address, 22500)

        expect(await vault.reservedAmounts(btc.address)).eq(0)
        expect(await vault.guaranteedUsd(btc.address)).eq(0)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(0) // lastIncreasedTime

        const tx = await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)
        await reportGasUsed(provider, tx, 'increasePosition gas used')

        const blockTime = await getBlockTime(provider)

        expect(await vault.poolAmounts(btc.address)).eq(256792 - 114)
        expect(await vault.reservedAmounts(btc.address)).eq(117500)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047))
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(92.79))
        expect(await milpManager.getAumInMusd(true)).eq('95109980000000000000') // 95.10998
        expect(await milpManager.getAumInMusd(false)).eq('93718200000000000000') // 93.7182

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(117500) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(blockTime) // lastIncreasedTime

        expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114) // fee is 0.047 USD => 0.00000114 BTC
        expect(await vault.musdAmounts(btc.address)).eq('93716800000000000000') // (117500 - 1 - 353) * 40000 * 2
        expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 - 114)

        expect(await vault.globalShortSizes(btc.address)).eq(0)
        expect(await vault.globalShortAveragePrices(btc.address)).eq(0)

        await validateVaultBalance(expect, vault, btc)
    })

    it('increasePosition long aum', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(100000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(100000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(100000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))

        expect(await vault.feeReserves(btc.address)).eq(0)
        expect(await vault.musdAmounts(btc.address)).eq(0)
        expect(await vault.poolAmounts(btc.address)).eq(0)

        expect(await milpManager.getAumInMusd(true)).eq(0)
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
        await vault.buyMUSD(btc.address, user1.address)
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700))
        expect(await milpManager.getAumInMusd(true)).eq(expandDecimals(99700, 18))

        expect(await vault.feeReserves(btc.address)).eq('300000') // 0.003 BTC
        expect(await vault.musdAmounts(btc.address)).eq(expandDecimals(99700, 18))
        expect(await vault.poolAmounts(btc.address)).eq('99700000') // 0.997

        await btc.mint(user0.address, expandDecimals(5, 7))
        await btc.connect(user0).transfer(vault.address, expandDecimals(5, 7))

        expect(await vault.reservedAmounts(btc.address)).eq(0)
        expect(await vault.guaranteedUsd(btc.address)).eq(0)

        let position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(0) // lastIncreasedTime

        const tx = await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(80000), true)
        await reportGasUsed(provider, tx, 'increasePosition gas used')

        const blockTime = await getBlockTime(provider)

        expect(await vault.poolAmounts(btc.address)).eq('149620000') // 1.4962 BTC
        expect(await vault.reservedAmounts(btc.address)).eq('80000000') // 0.8 BTC
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(30080)) // 80000 - 49920
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(99700))
        expect(await milpManager.getAumInMusd(true)).eq(expandDecimals(99700, 18))
        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(99700, 18))

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(80000)) // size
        expect(position[1]).eq(toUsd(49920)) // collateral
        expect(position[2]).eq(toNormalizedPrice(100000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq('80000000') // 0.8 BTC
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(blockTime) // lastIncreasedTime

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(150000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(150000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(150000), lastUpdate: 0 }], 0)

        let delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(true)
        expect(delta[1]).eq(toUsd(40000))
        expect(await milpManager.getAumInMusd(true)).eq(expandDecimals(134510, 18)) // 30080 + (1.4962-0.8)*150000
        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(134510, 18)) // 30080 + (1.4962-0.8)*150000

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(75000), lastUpdate: 0 }], 0)

        // set last price
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        delta = await vaultPositionController.getPositionDelta(user0.address, btc.address, btc.address, true)
        expect(delta[0]).eq(false)
        expect(delta[1]).eq(toUsd(40000))
        expect(await milpManager.getAumInMusd(true)).eq(expandDecimals(82295, 18)) // 30080 + (1.4962-0.8)*75000
        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(64890, 18)) // 30080 + (1.4962-0.8)*50000

        await vaultPositionController.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(80000), true, user2.address)

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(0) // size
        expect(position[1]).eq(0) // collateral
        expect(position[2]).eq(0) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(0) // reserveAmount
        expect(position[5]).eq(0) // realizedPnl
        expect(position[6]).eq(true) // hasProfit
        expect(position[7]).eq(0) // lastIncreasedTime

        expect(await vault.poolAmounts(btc.address)).eq('136393334') // 1.36393334 BTC
        expect(await vault.reservedAmounts(btc.address)).eq(0) // 0.8 BTC
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(0))
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq('68196667000000000000000000000000000')
        expect(await milpManager.getAumInMusd(true)).eq('102295000500000000000000') // 102295.0005
        expect(await milpManager.getAumInMusd(false)).eq('68196667000000000000000') // 68196.667

        expect(await vault.globalShortSizes(btc.address)).eq(0)
        expect(await vault.globalShortAveragePrices(btc.address)).eq(0)

        await validateVaultBalance(expect, vault, btc)
    })
})
