const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, increaseBlockTime, mineBlock, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.depositCollateral', function () {
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

    it('deposit collateral', async () => {
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

        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        expect(await vault.feeReserves(btc.address)).eq(0)
        expect(await vault.musdAmounts(btc.address)).eq(0)
        expect(await vault.poolAmounts(btc.address)).eq(0)

        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
        await vault.buyMUSD(btc.address, user1.address)
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd('46.8584'))

        expect(await vault.feeReserves(btc.address)).eq(353) // (117500 - 1) * 0.3% => 353
        expect(await vault.musdAmounts(btc.address)).eq('46858400000000000000') // (117500 - 1 - 353) * 40000
        expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353)

        await btc.connect(user0).transfer(vault.address, 117500 - 1)
        await expect(vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(100), true)).to.be.revertedWith(
            'Vault: reserve exceeds pool'
        )

        await vault.buyMUSD(btc.address, user1.address)

        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd('93.7168'))

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

        expect(await milpManager.getAumInMusd(false)).eq('93716800000000000000') // 93.7168
        expect(await milpManager.getAumInMusd(true)).eq('96059720000000000000') // 96.05972

        const tx0 = await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)
        await reportGasUsed(provider, tx0, 'increasePosition gas used')

        expect(await milpManager.getAumInMusd(false)).eq('93718200000000000000') // 93.7182
        expect(await milpManager.getAumInMusd(true)).eq('95109980000000000000') // 95.10998

        expect(await vault.poolAmounts(btc.address)).eq(256792 - 114)
        expect(await vault.reservedAmounts(btc.address)).eq(117500)
        expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(38.047))
        expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(92.79)) // (256792 - 117500) sat * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(117500) // reserveAmount

        expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114) // fee is 0.047 USD => 0.00000114 BTC
        expect(await vault.musdAmounts(btc.address)).eq('93716800000000000000') // (117500 - 1 - 353) * 40000 * 2
        expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 - 114)

        let leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(52496) // ~5.2x

        await btc.connect(user0).transfer(vault.address, 22500)

        expect(await milpManager.getAumInMusd(false)).eq('93718200000000000000') // 93.7182
        expect(await milpManager.getAumInMusd(true)).eq('95109980000000000000') // 95.10998

        const tx1 = await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true)
        await reportGasUsed(provider, tx1, 'deposit collateral gas used')

        expect(await milpManager.getAumInMusd(false)).eq('93718200000000000000') // 93.7182
        expect(await milpManager.getAumInMusd(true)).eq('95334980000000000000') // 95.33498

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953 + 9)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(117500) // reserveAmount

        expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114) // fee is 0.047 USD => 0.00000114 BTC
        expect(await vault.musdAmounts(btc.address)).eq('93716800000000000000') // (117500 - 1 - 353) * 40000 * 2
        expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 + 22500 - 114)

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(26179) // ~2.6x

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(51000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(50000), lastUpdate: 0 }], 0)

        expect(await milpManager.getAumInMusd(false)).eq('109886000000000000000') // 109.886
        expect(await milpManager.getAumInMusd(true)).eq('111502780000000000000') // 111.50278

        await btc.connect(user0).transfer(vault.address, 100)
        await vaultPositionController.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true)

        expect(await milpManager.getAumInMusd(false)).eq('109886000000000000000') // 109.886
        expect(await milpManager.getAumInMusd(true)).eq('111503780000000000000') // 111.50378

        position = await vaultPositionController.getPosition(user0.address, btc.address, btc.address, true)
        expect(position[0]).eq(toUsd(47)) // size
        expect(position[1]).eq(toUsd(8.953 + 9 + 0.05)) // collateral
        expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
        expect(position[3]).eq(0) // entryFundingRate
        expect(position[4]).eq(117500) // reserveAmount

        expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114) // fee is 0.047 USD => 0.00000114 BTC
        expect(await vault.musdAmounts(btc.address)).eq('93716800000000000000') // (117500 - 1 - 353) * 40000 * 2
        expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500 + 22500 + 100 - 114)

        leverage = await vaultPositionController.getPositionLeverage(user0.address, btc.address, btc.address, true)
        expect(leverage).eq(26106) // ~2.6x

        await validateVaultBalance(expect, vault, btc)
    })
})
