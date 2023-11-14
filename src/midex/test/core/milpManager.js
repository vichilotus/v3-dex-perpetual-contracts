const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed, newWallet } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('./Vault/helpers')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')

use(solidity)

describe('MilpManager', function () {
    const provider = waffle.provider
    const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let vaultPositionController
    let milpManager
    let milp
    let musd
    let router
    let vaultPriceFeed
    let bnb
    let btc
    let eth
    let dai
    let busd
    let busdPriceFeed
    let distributor0
    let yieldTracker0
    let reader
    let miOracle
    let fulfillController

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])
        busd = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])
        milp = await deployContract('MILP', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        distributor0 = await deployContract('TimeDistributor', [])
        yieldTracker0 = await deployContract('YieldTracker', [musd.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)
        await musd.setYieldTrackers([yieldTracker0.address])

        reader = await deployContract('Reader', [])

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set fulfillController
        await fulfillController.setController(wallet.address, true)
        await fulfillController.setHandler(milpManager.address, true)

        // set milpManager
        await milpManager.setFulfillController(fulfillController.address)

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

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

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)

        await vault.setInManagerMode(true)
    })

    it('inits', async () => {
        expect(await milpManager.governor()).eq(wallet.address)
        expect(await milpManager.vault()).eq(vault.address)
        expect(await milpManager.musd()).eq(musd.address)
        expect(await milpManager.milp()).eq(milp.address)
        expect(await milpManager.coolDownDuration()).eq(24 * 60 * 60)
    })

    it('transferGovernance', async () => {
        await expect(milpManager.connect(user0).transferGovernance(user1.address)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        expect(await milpManager.governor()).eq(wallet.address)

        await milpManager.transferGovernance(user0.address)
        await milpManager.connect(user0).acceptGovernance()
        expect(await milpManager.governor()).eq(user0.address)

        await milpManager.connect(user0).transferGovernance(user1.address)
        await milpManager.connect(user1).acceptGovernance()
        expect(await milpManager.governor()).eq(user1.address)
        await milpManager.connect(user0).acceptGovernance()
        expect(await milpManager.governor()).eq(user0.address)
    })

    it('setHandler', async () => {
        await expect(milpManager.connect(user0).setHandler(user1.address, true)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        expect(await milpManager.governor()).eq(wallet.address)
        await milpManager.transferGovernance(user0.address)
        await milpManager.connect(user0).acceptGovernance()
        expect(await milpManager.governor()).eq(user0.address)

        expect(await milpManager.isHandler(user1.address)).eq(false)
        await milpManager.connect(user0).setHandler(user1.address, true)
        expect(await milpManager.isHandler(user1.address)).eq(true)
    })

    it('setCoolDownDuration', async () => {
        await expect(milpManager.connect(user0).setCoolDownDuration(1000)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        await milpManager.transferGovernance(user0.address)
        await milpManager.connect(user0).acceptGovernance()

        await expect(milpManager.connect(user0).setCoolDownDuration(48 * 60 * 60 + 1)).to.be.revertedWith('MilpManager: invalid _coolDownDuration')

        expect(await milpManager.coolDownDuration()).eq(24 * 60 * 60)
        await milpManager.connect(user0).setCoolDownDuration(48 * 60 * 60)
        expect(await milpManager.coolDownDuration()).eq(48 * 60 * 60)
    })

    it('setAumAdjustment', async () => {
        await expect(milpManager.connect(user0).setAumAdjustment(29, 17)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        await milpManager.transferGovernance(user0.address)
        await milpManager.connect(user0).acceptGovernance()

        expect(await milpManager.aumAddition()).eq(0)
        expect(await milpManager.aumDeduction()).eq(0)
        expect(await milpManager.getAum(true, false)).eq(0)
        await milpManager.connect(user0).setAumAdjustment(29, 17)
        expect(await milpManager.aumAddition()).eq(29)
        expect(await milpManager.aumDeduction()).eq(17)
        expect(await milpManager.getAum(true, false)).eq(12)
    })

    it('addLiquidity, removeLiquidity', async () => {
        await dai.mint(user0.address, expandDecimals(100, 18))
        await dai.connect(user0).approve(milpManager.address, expandDecimals(100, 18))

        await milpManager.setFulfillController(user0.address)

        await expect(
            milpManager
                .connect(user0)
                .handlerAddLiquidity(user0.address, user0.address, dai.address, expandDecimals(100, 18), expandDecimals(101, 18), expandDecimals(101, 18))
        ).to.be.revertedWith('Vault: forbidden')

        await vault.setManager(milpManager.address, true)

        await expect(
            milpManager
                .connect(user0)
                .handlerAddLiquidity(user0.address, user0.address, dai.address, expandDecimals(100, 18), expandDecimals(101, 18), expandDecimals(101, 18))
        ).to.be.revertedWith('MilpManager: insufficient MUSD output')

        await milpManager.setFulfillController(fulfillController.address)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await dai.balanceOf(user0.address)).eq(expandDecimals(100, 18))
        expect(await dai.balanceOf(vault.address)).eq(0)
        expect(await musd.balanceOf(milpManager.address)).eq(0)
        expect(await milp.balanceOf(user0.address)).eq(0)
        expect(await milpManager.lastAddedAt(user0.address)).eq(0)
        expect(await milpManager.getAumInMusd(true)).eq(0)

        const tx0 = await milpManager.connect(user0).addLiquidity(dai.address, expandDecimals(100, 18), expandDecimals(99, 18), expandDecimals(99, 18))
        await reportGasUsed(provider, tx0, 'addLiquidity gas used')

        await increaseBlockTime(provider, 10)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        let blockTime = await getBlockTime(provider)

        expect(await dai.balanceOf(user0.address)).eq(0)
        expect(await dai.balanceOf(vault.address)).eq(expandDecimals(100, 18))
        expect(await musd.balanceOf(milpManager.address)).eq('99700000000000000000') // 99.7
        expect(await milp.balanceOf(user0.address)).eq('99700000000000000000')
        expect(await milp.totalSupply()).eq('99700000000000000000')
        expect(await milpManager.lastAddedAt(user0.address)).eq(blockTime)

        expect(await milpManager.getAumInMusd(true)).eq('99700000000000000000')
        expect(await milpManager.getAumInMusd(false)).eq('99700000000000000000')

        await bnb.mint(user1.address, expandDecimals(1, 18))
        await bnb.connect(user1).approve(milpManager.address, expandDecimals(1, 18))

        await milpManager.connect(user1).addLiquidity(bnb.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        blockTime = await getBlockTime(provider)

        expect(await musd.balanceOf(milpManager.address)).eq('398800000000000000000') // 398.8
        expect(await milp.balanceOf(user0.address)).eq('99700000000000000000') // 99.7
        expect(await milp.balanceOf(user1.address)).eq('299100000000000000000') // 299.1
        expect(await milp.totalSupply()).eq('398800000000000000000')
        expect(await milpManager.lastAddedAt(user1.address)).eq(blockTime)
        expect(await milpManager.getAumInMusd(true)).eq('498500000000000000000')
        expect(await milpManager.getAumInMusd(false)).eq('398800000000000000000')

        await expect(milp.connect(user1).transfer(user2.address, expandDecimals(1, 18))).to.be.revertedWith('BaseToken: msg.sender not whitelisted')

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        expect(await milpManager.getAumInMusd(true)).eq('598200000000000000000') // 598.2
        expect(await milpManager.getAumInMusd(false)).eq('498500000000000000000') // 498.5

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        await btc.mint(user2.address, '1000000') // 0.01 BTC, $500
        await btc.connect(user2).approve(milpManager.address, expandDecimals(1, 18))

        await milpManager.setFulfillController(user2.address)

        await expect(
            milpManager
                .connect(user2)
                .handlerAddLiquidity(user2.address, user2.address, btc.address, '1000000', expandDecimals(599, 18), expandDecimals(399, 18))
        ).to.be.revertedWith('MilpManager: insufficient MUSD output')

        await expect(
            milpManager
                .connect(user2)
                .handlerAddLiquidity(user2.address, user2.address, btc.address, '1000000', expandDecimals(598, 18), expandDecimals(399, 18))
        ).to.be.revertedWith('MilpManager: insufficient MILP output')

        await milpManager.setFulfillController(fulfillController.address)

        await milpManager.connect(user2).addLiquidity(btc.address, '1000000', expandDecimals(598, 18), expandDecimals(398, 18))

        await increaseBlockTime(provider, 10)
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        blockTime = await getBlockTime(provider)

        expect(await musd.balanceOf(milpManager.address)).eq('997000000000000000000') // 997
        expect(await milp.balanceOf(user0.address)).eq('99700000000000000000') // 99.7
        expect(await milp.balanceOf(user1.address)).eq('299100000000000000000') // 299.1
        expect(await milp.balanceOf(user2.address)).eq('398800000000000000000') // 398.8
        expect(await milp.totalSupply()).eq('797600000000000000000') // 797.6
        expect(await milpManager.lastAddedAt(user2.address)).eq(blockTime)

        expect(await milpManager.getAumInMusd(true)).eq('1196400000000000000000') // 1196.4
        expect(await milpManager.getAumInMusd(false)).eq('1096700000000000000000') // 1096.7

        await milpManager.setFulfillController(user0.address)

        await expect(
            milpManager.connect(user0).removeLiquidity(dai.address, '99700000000000000000', expandDecimals(123, 18), user0.address)
        ).to.be.revertedWith('MilpManager: coolDown duration not yet passed')

        await increaseTime(provider, 24 * 60 * 60 + 1)
        await mineBlock(provider)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(400), lastUpdate: 0 },
            ],
            0
        )

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        await expect(
            milpManager.connect(user0).handlerRemoveLiquidity(user0.address, user0.address, dai.address, expandDecimals(73, 18), expandDecimals(100, 18))
        ).to.be.revertedWith('Vault: poolAmount exceeded')

        await milpManager.setFulfillController(fulfillController.address)

        expect(await dai.balanceOf(user0.address)).eq(0)
        expect(await milp.balanceOf(user0.address)).eq('99700000000000000000') // 99.7

        // await milp.connect(user0).approve(milpManager.address, expandDecimals(72, 18))
        await milpManager.connect(user0).removeLiquidity(dai.address, expandDecimals(72, 18), expandDecimals(98, 18), user0.address)

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        expect(await dai.balanceOf(user0.address)).eq('98703000000000000000') // 98.703, 72 * 1096.7 / 797.6 => 99
        expect(await bnb.balanceOf(user0.address)).eq(0)
        expect(await milp.balanceOf(user0.address)).eq('27700000000000000000') // 27.7

        await milpManager.connect(user0).removeLiquidity(
            bnb.address,
            '27700000000000000000', // 27.7, 27.7 * 1096.7 / 797.6 => 38.0875
            '75900000000000000', // 0.0759 BNB => 37.95 USD
            user0.address
        )

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        expect(await dai.balanceOf(user0.address)).eq('98703000000000000000')
        expect(await bnb.balanceOf(user0.address)).eq('75946475000000000') // 0.075946475
        expect(await milp.balanceOf(user0.address)).eq(0)

        expect(await milp.totalSupply()).eq('697900000000000000000') // 697.9
        expect(await milpManager.getAumInMusd(true)).eq('1059312500000000000000') // 1059.3125
        expect(await milpManager.getAumInMusd(false)).eq('967230000000000000000') // 967.23

        expect(await bnb.balanceOf(user1.address)).eq(0)
        expect(await milp.balanceOf(user1.address)).eq('299100000000000000000')

        await milpManager.connect(user1).removeLiquidity(
            bnb.address,
            '299100000000000000000', // 299.1, 299.1 * 967.23 / 697.9 => 414.527142857
            '826500000000000000', // 0.8265 BNB => 413.25
            user1.address
        )

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        expect(await bnb.balanceOf(user1.address)).eq('826567122857142856') // 0.826567122857142856
        expect(await milp.balanceOf(user1.address)).eq(0)

        expect(await milp.totalSupply()).eq('398800000000000000000') // 398.8
        expect(await milpManager.getAumInMusd(true)).eq('644785357142857143000') // 644.785357142857143
        expect(await milpManager.getAumInMusd(false)).eq('635608285714285714400') // 635.6082857142857144

        expect(await btc.balanceOf(user2.address)).eq(0)
        expect(await milp.balanceOf(user2.address)).eq('398800000000000000000') // 398.8

        expect(await vault.poolAmounts(dai.address)).eq('700000000000000000') // 0.7
        expect(await vault.poolAmounts(bnb.address)).eq('91770714285714286') // 0.091770714285714286
        expect(await vault.poolAmounts(btc.address)).eq('997000') // 0.00997

        await milpManager.setFulfillController(user2.address)

        await expect(
            milpManager.connect(user2).handlerRemoveLiquidity(
                user2.address,
                user2.address,
                btc.address,
                expandDecimals(375, 18),
                '990000' // 0.0099
            )
        ).to.be.revertedWith('MUSD: forbidden')

        await milpManager.setFulfillController(fulfillController.address)

        await musd.addVault(milpManager.address)

        const tx1 = await milpManager.connect(user2).removeLiquidity(
            btc.address,
            expandDecimals(375, 18),
            '990000', // 0.0099
            user2.address
        )
        await reportGasUsed(provider, tx1, 'removeLiquidity gas used')

        const tx2 = await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 },
            ],
            0
        )

        await reportGasUsed(provider, tx2, 'handlerRemoveLiquidity gas used')

        expect(await btc.balanceOf(user2.address)).eq('993137')
        expect(await milp.balanceOf(user2.address)).eq('23800000000000000000') // 23.8
    })
})
