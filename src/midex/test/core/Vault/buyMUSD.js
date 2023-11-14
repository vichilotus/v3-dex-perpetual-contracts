const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.buyMUSD', function () {
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

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])
    })

    it('buyMUSD', async () => {
        await expect(vault.buyMUSD(bnb.address, wallet.address)).to.be.revertedWith('Vault: _token not whitelisted')

        await expect(vault.connect(user0).buyMUSD(bnb.address, user1.address)).to.be.revertedWith('Vault: _token not whitelisted')

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await expect(vault.connect(user0).buyMUSD(bnb.address, user1.address)).to.be.revertedWith('Vault: invalid tokenAmount')

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(0)
        expect(await vault.feeReserves(bnb.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)

        await bnb.mint(user0.address, 100)
        await bnb.connect(user0).transfer(vault.address, 100)
        const tx = await vault.connect(user0).buyMUSD(bnb.address, user1.address, { gasPrice: '10000000000' })
        await reportGasUsed(provider, tx, 'buyMUSD gas used')

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(29700)
        expect(await vault.feeReserves(bnb.address)).eq(1)
        expect(await vault.musdAmounts(bnb.address)).eq(29700)
        expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

        await validateVaultBalance(expect, vault, bnb)

        expect(await milpManager.getAumInMusd(true)).eq(29700)
    })

    it('buyMUSD allows gov to mint', async () => {
        await vault.setInManagerMode(true)
        await expect(vault.buyMUSD(bnb.address, wallet.address)).to.be.revertedWith('Vault: forbidden')

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await bnb.mint(wallet.address, 100)
        await bnb.transfer(vault.address, 100)

        expect(await musd.balanceOf(wallet.address)).eq(0)
        expect(await vault.feeReserves(bnb.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)

        await expect(vault.connect(user0).buyMUSD(bnb.address, wallet.address)).to.be.revertedWith('Vault: forbidden')

        await vault.setManager(user0.address, true)
        await vault.connect(user0).buyMUSD(bnb.address, wallet.address)

        expect(await musd.balanceOf(wallet.address)).eq(29700)
        expect(await vault.feeReserves(bnb.address)).eq(1)
        expect(await vault.musdAmounts(bnb.address)).eq(29700)
        expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

        await validateVaultBalance(expect, vault, bnb)
    })

    it('buyMUSD uses min price', async () => {
        await expect(vault.connect(user0).buyMUSD(bnb.address, user1.address)).to.be.revertedWith('Vault: _token not whitelisted')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(200), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(250), lastUpdate: 0 }], 0)

        await vault.setTokenConfig(...getBnbConfig(bnb))

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(0)
        expect(await vault.feeReserves(bnb.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)
        await bnb.mint(user0.address, 100)
        await bnb.connect(user0).transfer(vault.address, 100)
        await vault.connect(user0).buyMUSD(bnb.address, user1.address)
        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(19800)
        expect(await vault.feeReserves(bnb.address)).eq(1)
        expect(await vault.musdAmounts(bnb.address)).eq(19800)
        expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

        await validateVaultBalance(expect, vault, bnb)
    })

    it('buyMUSD updates fees', async () => {
        await expect(vault.connect(user0).buyMUSD(bnb.address, user1.address)).to.be.revertedWith('Vault: _token not whitelisted')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(0)
        expect(await vault.feeReserves(bnb.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)
        await bnb.mint(user0.address, 10000)
        await bnb.connect(user0).transfer(vault.address, 10000)
        await vault.connect(user0).buyMUSD(bnb.address, user1.address)
        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(9970 * 300)
        expect(await vault.feeReserves(bnb.address)).eq(30)
        expect(await vault.musdAmounts(bnb.address)).eq(9970 * 300)
        expect(await vault.poolAmounts(bnb.address)).eq(10000 - 30)

        await validateVaultBalance(expect, vault, bnb)
    })

    it('buyMUSD uses mintBurnFeeBasisPoints', async () => {
        await increaseBlockTime(provider, 10) // skip blockTime 10 sec
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )
        await vault.setTokenConfig(...getDaiConfig(dai))

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

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(0)
        expect(await vault.feeReserves(bnb.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)
        await dai.mint(user0.address, expandDecimals(10000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await vault.connect(user0).buyMUSD(dai.address, user1.address)
        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(expandDecimals(10000 - 4, 18))
        expect(await vault.feeReserves(dai.address)).eq(expandDecimals(4, 18))
        expect(await vault.musdAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
        expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
    })

    it('buyMUSD adjusts for decimals', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await expect(vault.connect(user0).buyMUSD(btc.address, user1.address)).to.be.revertedWith('Vault: invalid tokenAmount')

        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await musd.balanceOf(user1.address)).eq(0)
        expect(await vault.feeReserves(btc.address)).eq(0)
        expect(await vault.musdAmounts(bnb.address)).eq(0)
        expect(await vault.poolAmounts(bnb.address)).eq(0)
        await btc.mint(user0.address, expandDecimals(1, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
        await vault.connect(user0).buyMUSD(btc.address, user1.address)
        expect(await musd.balanceOf(user0.address)).eq(0)
        expect(await vault.feeReserves(btc.address)).eq(300000)
        expect(await musd.balanceOf(user1.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18))) // 0.3% of 60,000 => 180
        expect(await vault.musdAmounts(btc.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18)))
        expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub(300000))

        await validateVaultBalance(expect, vault, btc)
    })
})
