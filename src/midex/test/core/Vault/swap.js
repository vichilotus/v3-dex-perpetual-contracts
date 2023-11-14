const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getEthConfig, getDaiConfig, tokenIndexes } = require('./helpers')
const { deployMiOracle, getPriceFeed } = require('../../shared/miOracle')

use(solidity)

describe('Vault.swap', function () {
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
    let distributor0
    let yieldTracker0

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
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

        milp = await deployContract('MILP', [])
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])
    })

    it('swap', async () => {
        await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address)).to.be.revertedWith('Vault: _tokenIn not whitelisted')

        await vault.setIsSwapEnabled(false)

        await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address)).to.be.revertedWith('Vault: swaps not enabled')

        await vault.setIsSwapEnabled(true)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address)).to.be.revertedWith('Vault: _tokenOut not whitelisted')

        await expect(vault.connect(user1).swap(bnb.address, bnb.address, user2.address)).to.be.revertedWith('Vault: invalid tokens')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBtcConfig(btc))

        await bnb.mint(user0.address, expandDecimals(200, 18))
        await btc.mint(user0.address, expandDecimals(1, 8))

        expect(await milpManager.getAumInMusd(false)).eq(0)

        await bnb.connect(user0).transfer(vault.address, expandDecimals(200, 18))
        await vault.connect(user0).buyMUSD(bnb.address, user0.address)

        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(59820, 18)) // 60,000 * 99.7%

        await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
        await vault.connect(user0).buyMUSD(btc.address, user0.address)

        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(119640, 18)) // 59,820 + (60,000 * 99.7%)

        expect(await musd.balanceOf(user0.address)).eq(expandDecimals(120000, 18).sub(expandDecimals(360, 18))) // 120,000 * 0.3% => 360

        expect(await vault.feeReserves(bnb.address)).eq('600000000000000000') // 200 * 0.3% => 0.6
        expect(await vault.musdAmounts(bnb.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18))) // 60,000 * 0.3% => 180
        expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(200, 18).sub('600000000000000000'))

        expect(await vault.feeReserves(btc.address)).eq('300000') // 1 * 0.3% => 0.003
        expect(await vault.musdAmounts(btc.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18)))
        expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub('300000'))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(600), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB, tokenIndexes.ETH], 10, 3)

        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(139580, 18)) // 59,820 / 300 * 400 + 59820

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(90000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(100000), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(80000), lastUpdate: 0 }], 0)

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB, tokenIndexes.ETH], 10, 3)

        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(159520, 18)) // 59,820 / 300 * 400 + 59820 / 60000 * 80000

        await bnb.mint(user1.address, expandDecimals(100, 18))
        await bnb.connect(user1).transfer(vault.address, expandDecimals(100, 18))

        expect(await btc.balanceOf(user1.address)).eq(0)
        expect(await btc.balanceOf(user2.address)).eq(0)
        const tx = await vault.connect(user1).swap(bnb.address, btc.address, user2.address)
        await reportGasUsed(provider, tx, 'swap gas used')

        expect(await milpManager.getAumInMusd(false)).eq(expandDecimals(167520, 18)) // 159520 + (100 * 400) - 32000

        expect(await btc.balanceOf(user1.address)).eq(0)
        expect(await btc.balanceOf(user2.address)).eq(expandDecimals(4, 7).sub('120000')) // 0.8 - 0.0012

        expect(await vault.feeReserves(bnb.address)).eq('600000000000000000') // 200 * 0.3% => 0.6
        expect(await vault.musdAmounts(bnb.address)).eq(
            expandDecimals(100 * 400, 18)
                .add(expandDecimals(200 * 300, 18))
                .sub(expandDecimals(180, 18))
        )
        expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(100, 18).add(expandDecimals(200, 18)).sub('600000000000000000'))

        expect(await vault.feeReserves(btc.address)).eq('420000') // 1 * 0.3% => 0.003, 0.4 * 0.3% => 0.0012
        expect(await vault.musdAmounts(btc.address)).eq(
            expandDecimals(200 * 300, 18)
                .sub(expandDecimals(180, 18))
                .sub(expandDecimals(100 * 400, 18))
        )
        expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub('300000').sub(expandDecimals(4, 7))) // 59700000, 0.597 BTC, 0.597 * 100,000 => 59700

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(450), lastUpdate: 0 }], 0)

        expect(await bnb.balanceOf(user0.address)).eq(0)
        expect(await bnb.balanceOf(user3.address)).eq(0)
        await musd.connect(user0).transfer(vault.address, expandDecimals(50000, 18))
        await vault.sellMUSD(bnb.address, user3.address)
        expect(await bnb.balanceOf(user0.address)).eq(0)
        expect(await bnb.balanceOf(user3.address)).eq('99700000000000000000') // 99.7, 50000 / 500 * 99.7%

        await musd.connect(user0).transfer(vault.address, expandDecimals(50000, 18))

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB, tokenIndexes.ETH], 10, 3)

        await vault.sellMUSD(btc.address, user3.address)

        await musd.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await expect(vault.sellMUSD(btc.address, user3.address)).to.be.revertedWith('Vault: poolAmount exceeded')
    })

    it('caps max MUSD amount', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(600), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(3000), lastUpdate: 0 }], 0)

        const bnbConfig = getBnbConfig(bnb)
        const ethConfig = getBnbConfig(eth)

        bnbConfig[4] = expandDecimals(299000, 18)
        await vault.setTokenConfig(...bnbConfig)

        ethConfig[4] = expandDecimals(30000, 18)
        await vault.setTokenConfig(...ethConfig)

        await bnb.mint(user0.address, expandDecimals(499, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(499, 18))
        await vault.connect(user0).buyMUSD(bnb.address, user0.address)

        await eth.mint(user0.address, expandDecimals(10, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
        await vault.connect(user0).buyMUSD(eth.address, user1.address)

        await bnb.mint(user0.address, expandDecimals(1, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))

        await expect(vault.connect(user0).buyMUSD(bnb.address, user0.address)).to.be.revertedWith('Vault: max MUSD exceeded')

        bnbConfig[4] = expandDecimals(299100, 18)
        await vault.setTokenConfig(...bnbConfig)

        await vault.connect(user0).buyMUSD(bnb.address, user0.address)

        await bnb.mint(user0.address, expandDecimals(1, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))
        await expect(vault.connect(user0).swap(bnb.address, eth.address, user1.address)).to.be.revertedWith('Vault: max MUSD exceeded')

        bnbConfig[4] = expandDecimals(299700, 18)
        await vault.setTokenConfig(...bnbConfig)
        await vault.connect(user0).swap(bnb.address, eth.address, user1.address)
    })

    it('does not cap max MUSD debt', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(600), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(3000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getEthConfig(eth))

        await bnb.mint(user0.address, expandDecimals(100, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18))
        await vault.connect(user0).buyMUSD(bnb.address, user0.address)

        await eth.mint(user0.address, expandDecimals(10, 18))

        expect(await eth.balanceOf(user0.address)).eq(expandDecimals(10, 18))
        expect(await bnb.balanceOf(user1.address)).eq(0)

        await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
        await vault.connect(user0).swap(eth.address, bnb.address, user1.address)

        expect(await eth.balanceOf(user0.address)).eq(0)
        expect(await bnb.balanceOf(user1.address)).eq('49850000000000000000')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 }], 0)

        await eth.mint(user0.address, expandDecimals(1, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB, tokenIndexes.ETH], 10, 3)

        await vault.connect(user0).swap(eth.address, bnb.address, user1.address)
    })

    it('ensures poolAmount >= buffer', async () => {
        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(600), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(3000), lastUpdate: 0 }], 0)
        await vault.setTokenConfig(...getEthConfig(eth))

        await bnb.mint(user0.address, expandDecimals(100, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18))
        await vault.connect(user0).buyMUSD(bnb.address, user0.address)

        await vault.setBufferAmount(bnb.address, '94700000000000000000') // 94.7

        expect(await vault.poolAmounts(bnb.address)).eq('99700000000000000000') // 99.7
        expect(await vault.poolAmounts(eth.address)).eq(0)
        expect(await bnb.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).eq(0)

        await eth.mint(user0.address, expandDecimals(1, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
        await vault.connect(user0).swap(eth.address, bnb.address, user1.address)

        expect(await vault.poolAmounts(bnb.address)).eq('94700000000000000000') // 94.7
        expect(await vault.poolAmounts(eth.address)).eq(expandDecimals(1, 18))
        expect(await bnb.balanceOf(user1.address)).eq('4985000000000000000') // 4.985
        expect(await eth.balanceOf(user1.address)).eq(0)

        await eth.mint(user0.address, expandDecimals(1, 18))
        await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
        await expect(vault.connect(user0).swap(eth.address, bnb.address, user1.address)).to.be.revertedWith('Vault: poolAmount < buffer')
    })
})
