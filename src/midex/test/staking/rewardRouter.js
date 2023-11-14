const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed, print, newWallet } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('../core/Vault/helpers')

use(solidity)

describe('RewardRouter', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3, user4, tokenManager] = provider.getWallets()

    // const vestingDuration = 365 * 24 * 60 * 60

    let timeLock
    // let rewardManager

    let vault
    let milpManager
    let milp
    let musd
    let router
    let vaultPriceFeed
    // let bnb
    let btc
    let eth
    let dai
    let busd

    let feeMilpTracker
    let feeMilpDistributor

    let rewardRouter
    let miOracle
    let fulfillController
    let depositFund

    beforeEach(async () => {
        rewardManager = await deployContract('RewardManager', [])
        timeLock = await deployContract('TimeLock', [
            wallet.address,
            10,
            rewardManager.address,
            tokenManager.address,
            tokenManager.address,
            expandDecimals(1000000, 18),
            10,
            100,
        ])

        // bnb = await deployContract("Token", [])

        btc = await deployContract('Token', [])

        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])
        busd = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, eth.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])
        milp = await deployContract('MILP', [])
        rewardRouter = await deployContract('RewardRouter', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        // deploy miOracle
        miOracle = await deployMiOracle(eth)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, eth.address, 0])

        // deposit req fund to fulfillController
        await eth.mint(fulfillController.address, ethers.utils.parseEther('1.0'))
        depositFund = ethers.utils.parseEther('1.0')

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        // await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

        // set fulfillController
        await fulfillController.setController(wallet.address, true)

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // set vault
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(eth))

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)
        await milp.setHandler(rewardRouter.address, true)
        await milpManager.setInPrivateMode(true)

        // MILP
        feeMilpTracker = await deployContract('RewardTracker', ['Fee MILP', 'fMILP'])
        feeMilpDistributor = await deployContract('RewardDistributor', [eth.address, feeMilpTracker.address])
        await feeMilpTracker.initialize([milp.address], feeMilpDistributor.address)
        await feeMilpDistributor.updateLastDistributionTime()

        await feeMilpTracker.setInPrivateTransferMode(true)
        await feeMilpTracker.setInPrivateStakingMode(true)

        await rewardRouter.initialize(eth.address, milp.address, feeMilpTracker.address, milpManager.address, 0)

        await rewardManager.initialize(timeLock.address, rewardRouter.address, milpManager.address, feeMilpTracker.address)

        await milp.setHandler(feeMilpTracker.address, true)

        // setFulfillController
        await fulfillController.setHandler(rewardRouter.address, true)
        await rewardRouter.setFulfillController(fulfillController.address)
        await milpManager.setHandler(rewardRouter.address, true)

        await milpManager.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(milpManager.address)
        await feeMilpTracker.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(feeMilpTracker.address)
        await rewardManager.enableRewardRouter()
    })

    it('inits', async () => {
        expect(await rewardRouter.isInitialized()).eq(true)

        expect(await rewardRouter.weth()).eq(eth.address)

        expect(await rewardRouter.milp()).eq(milp.address)

        expect(await rewardRouter.feeMilpTracker()).eq(feeMilpTracker.address)

        expect(await rewardRouter.milpManager()).eq(milpManager.address)

        await expect(rewardRouter.initialize(eth.address, milp.address, feeMilpTracker.address, milpManager.address, 0)).to.be.revertedWith(
            'RewardRouter: already initialized'
        )

        expect(await rewardManager.timeLock()).eq(timeLock.address)
        expect(await rewardManager.rewardRouter()).eq(rewardRouter.address)
        expect(await rewardManager.milpManager()).eq(milpManager.address)
        expect(await rewardManager.feeMilpTracker()).eq(feeMilpTracker.address)

        await expect(rewardManager.initialize(timeLock.address, rewardRouter.address, milpManager.address, feeMilpTracker.address)).to.be.revertedWith(
            'RewardManager: already initialized'
        )
    })

    it('mintAndStakeMilp, unStakeAndRedeemMilp, compound', async () => {
        await eth.mint(feeMilpDistributor.address, expandDecimals(100, 18))
        await feeMilpDistributor.setTokensPerInterval('41335970000000') // 0.00004133597 ETH per second

        await eth.mint(user1.address, expandDecimals(1, 18))
        await eth.connect(user1).approve(rewardRouter.address, expandDecimals(1, 18))

        const tx0 = await rewardRouter.connect(user1).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await reportGasUsed(provider, tx0, 'mintAndStakeMilp gas used')

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await feeMilpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
        expect(await feeMilpTracker.depositBalances(user1.address, milp.address)).eq(expandDecimals(2991, 17))
        // expect(await stakedMilpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
        // expect(await stakedMilpTracker.depositBalances(user1.address, feeMilpTracker.address)).eq(expandDecimals(2991, 17))

        await eth.mint(user1.address, expandDecimals(2, 18))
        await eth.connect(user1).approve(rewardRouter.address, expandDecimals(2, 18))
        await rewardRouter.connect(user1).mintAndStakeMilp(eth.address, expandDecimals(2, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await increaseTime(provider, 24 * 60 * 60 + 1)
        await mineBlock(provider)

        expect(await feeMilpTracker.claimable(user1.address)).gt('3560000000000000000') // 3.56, 100 / 28 => ~3.57
        expect(await feeMilpTracker.claimable(user1.address)).lt('3580000000000000000') // 3.58

        // expect(await stakedMilpTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
        // expect(await stakedMilpTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

        await eth.mint(user2.address, expandDecimals(1, 18))

        await eth.connect(user2).approve(rewardRouter.address, expandDecimals(1, 18))
        await rewardRouter.connect(user2).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await rewardRouter.connect(user2).unStakeAndRedeemMilp(
            eth.address,
            expandDecimals(299, 18),
            '990000000000000000', // 0.99
            user2.address
        )

        // revertedWith("MilpManager: coolDown duration not yet passed")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await feeMilpTracker.stakedAmounts(user1.address)).eq('897300000000000000000') // 897.3
        // expect(await stakedMilpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
        expect(await eth.balanceOf(user1.address)).eq(0)

        const tx1 = await rewardRouter.connect(user1).unStakeAndRedeemMilp(
            eth.address,
            expandDecimals(299, 18),
            '990000000000000000', // 0.99
            user1.address
        )
        await reportGasUsed(provider, tx1, 'unStakeAndRedeemMilp gas used')

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await feeMilpTracker.stakedAmounts(user1.address)).eq('598300000000000000000') // 598.3
        // expect(await stakedMilpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
        expect(await eth.balanceOf(user1.address)).eq('993676666666666666') // ~0.99

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        expect(await feeMilpTracker.claimable(user1.address)).gt('5940000000000000000') // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
        expect(await feeMilpTracker.claimable(user1.address)).lt('5960000000000000000')
        expect(await feeMilpTracker.claimable(user2.address)).gt('1180000000000000000') // 1.18, 100 / 28 / 3 => ~1.19
        expect(await feeMilpTracker.claimable(user2.address)).lt('1200000000000000000')

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        const tx2 = await rewardRouter.connect(user1).compound()
        await reportGasUsed(provider, tx2, 'compound gas used')

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        // expect(await feeMilpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
        expect(await feeMilpTracker.stakedAmounts(user1.address)).gt('3091000000000000000000') // 598.3 + compound
        // expect(await stakedMilpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
        expect(await eth.balanceOf(user1.address)).eq('993676666666666666') // ~0.99
    })

    it('mintAndStakeMilpETH, unStakeAndRedeemMilpETH', async () => {
        const receiver0 = newWallet()

        await expect(rewardRouter.connect(user0).mintAndStakeMilpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: 0 })).to.be.revertedWith(
            'RewardRouter: invalid msg.value'
        )

        await rewardRouter.connect(user0).mintAndStakeMilpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) })

        // revertedWith("MilpManager: insufficient MUSD output")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await rewardRouter.connect(user0).mintAndStakeMilpETH(expandDecimals(299, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) })

        // revertedWith("MilpManager: insufficient MILP output")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await eth.balanceOf(user0.address)).eq(0)
        expect(await eth.balanceOf(vault.address)).eq(0)
        expect((await eth.totalSupply()).sub(depositFund)).eq(0)
        expect(await provider.getBalance(eth.address)).eq(0)
        // expect(await stakedMilpTracker.balanceOf(user0.address)).eq(0)

        await rewardRouter.connect(user0).mintAndStakeMilpETH(expandDecimals(299, 18), expandDecimals(299, 18), { value: expandDecimals(1, 18) })

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await eth.balanceOf(user0.address)).eq(0)
        expect(await eth.balanceOf(vault.address)).eq(expandDecimals(1, 18))
        expect(await provider.getBalance(eth.address)).eq(expandDecimals(1, 18))
        expect((await eth.totalSupply()).sub(depositFund)).eq(expandDecimals(1, 18))

        await rewardRouter.connect(user0).unStakeAndRedeemMilpETH(expandDecimals(300, 18), expandDecimals(1, 18), receiver0.address)

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await rewardRouter.connect(user0).unStakeAndRedeemMilpETH('299100000000000000000', expandDecimals(1, 18), receiver0.address)

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await increaseTime(provider, 24 * 60 * 60 + 10)

        await rewardRouter.connect(user0).unStakeAndRedeemMilpETH('299100000000000000000', expandDecimals(1, 18), receiver0.address)

        // revertedWith("MilpManager: insufficient output")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await rewardRouter.connect(user0).unStakeAndRedeemMilpETH('299100000000000000000', '990000000000000000', receiver0.address)

        // revertedWith("MilpManager: insufficient output")
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        expect(await provider.getBalance(receiver0.address)).eq('994009000000000000') // 0.994009
        expect(await eth.balanceOf(vault.address)).eq('5991000000000000') // 0.005991
        expect(await provider.getBalance(eth.address)).eq('5991000000000000')
        expect((await eth.totalSupply()).sub(depositFund)).eq('5991000000000000')
    })

    it('milp: signalTransfer, acceptTransfer', async () => {
        await eth.mint(feeMilpDistributor.address, expandDecimals(100, 18))
        await feeMilpDistributor.setTokensPerInterval('41335970000000') // 0.00004133597 ETH per second

        await eth.mint(user1.address, expandDecimals(1, 18))
        await eth.connect(user1).approve(rewardRouter.address, expandDecimals(1, 18))

        await rewardRouter.connect(user1).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await eth.mint(user2.address, expandDecimals(1, 18))
        await eth.connect(user2).approve(rewardRouter.address, expandDecimals(1, 18))
        await rewardRouter.connect(user2).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await rewardRouter.connect(user2).signalTransfer(user1.address)

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        await rewardRouter.connect(user2).signalTransfer(user1.address)
        await rewardRouter.connect(user1).compound()

        await rewardRouter.connect(user2).signalTransfer(user3.address)

        await expect(rewardRouter.connect(user3).acceptTransfer(user1.address)).to.be.revertedWith('RewardRouter: transfer not signalled')

        expect(await feeMilpTracker.depositBalances(user2.address, milp.address)).eq('299100000000000000000') // 299.1
        expect(await feeMilpTracker.depositBalances(user3.address, milp.address)).eq(0)

        await rewardRouter.connect(user3).acceptTransfer(user2.address)

        expect(await feeMilpTracker.depositBalances(user2.address, milp.address)).eq(0)
        expect(await feeMilpTracker.depositBalances(user3.address, milp.address)).eq('299100000000000000000') // 299.1

        await rewardRouter.connect(user1).compound()

        await expect(rewardRouter.connect(user3).acceptTransfer(user1.address)).to.be.revertedWith('RewardRouter: transfer not signalled')

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        await rewardRouter.connect(user1).claim()
        await rewardRouter.connect(user2).claim()
        await rewardRouter.connect(user3).claim()

        await rewardRouter.connect(user1).compound()
        await rewardRouter.connect(user3).compound()

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        await rewardRouter.connect(user3).unStakeAndRedeemMilp(eth.address, expandDecimals(1, 18), 0, user3.address)

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )
        return
    })

    it('handleRewards', async () => {
        const rewardManagerV2 = await deployContract('RewardManager', [])
        const timeLockV2 = await deployContract('TimeLock', [
            wallet.address,
            10,
            rewardManagerV2.address,
            tokenManager.address,
            tokenManager.address,
            expandDecimals(1000000, 18),
            10,
            100,
        ])

        // use new rewardRouter, use eth for weth
        const rewardRouter = await deployContract('RewardRouter', [])

        // setFulfillController
        await fulfillController.setHandler(rewardRouter.address, true)
        await rewardRouter.setFulfillController(fulfillController.address)
        await timeLock.signalSetHandler(milpManager.address, rewardRouter.address, true)

        await increaseTime(provider, 20)
        await mineBlock(provider)

        await timeLock.setHandler(milpManager.address, rewardRouter.address, true)
        const minRewardCompound = 0
        await rewardRouter.initialize(eth.address, milp.address, feeMilpTracker.address, milpManager.address, minRewardCompound)

        await rewardManagerV2.initialize(timeLockV2.address, rewardRouter.address, milpManager.address, feeMilpTracker.address)

        await timeLock.signalTransferGovernance(milpManager.address, timeLockV2.address)
        await timeLock.signalTransferGovernance(feeMilpTracker.address, timeLockV2.address)

        await increaseTime(provider, 20)
        await mineBlock(provider)

        await timeLock.transferGovernance(milpManager.address, timeLockV2.address)
        await timeLockV2.acceptGovernance(milpManager.address)
        await timeLock.transferGovernance(feeMilpTracker.address, timeLockV2.address)
        await timeLockV2.acceptGovernance(feeMilpTracker.address)

        await rewardManagerV2.enableRewardRouter()

        await eth.deposit({ value: expandDecimals(10, 18) })

        await eth.mint(feeMilpDistributor.address, expandDecimals(50, 18))
        await feeMilpDistributor.setTokensPerInterval('41335970000000') // 0.00004133597 ETH per second

        await eth.mint(user1.address, expandDecimals(1, 18))
        await eth.connect(user1).approve(rewardRouter.address, expandDecimals(1, 18))

        await rewardRouter.connect(user1).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
            ],
            0
        )

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        expect(await milp.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).eq(0)

        await rewardRouter.connect(user1).handleRewards(
            false // _shouldConvertWethToEth
        )

        expect(await milp.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await eth.balanceOf(user1.address)).lt(expandDecimals(4, 18)) // 4 WETH

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        const ethBalance0 = await provider.getBalance(user1.address)

        await rewardRouter.connect(user1).handleRewards(
            true // _shouldConvertWethToEth
        )

        const ethBalance1 = await provider.getBalance(user1.address)

        expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(4, 18)) // 4 WETH

        expect(await milp.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await eth.balanceOf(user1.address)).lt(expandDecimals(4, 18)) // 4 WETH

        await rewardRouter.connect(user1).handleRewards(
            false // _shouldConvertWethToEth
        )

        expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(4, 18)) // 4 WETH
        expect(await milp.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await eth.balanceOf(user1.address)).lt(expandDecimals(4, 18)) // 4 WETH

        expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(4, 18)) // 4 WETH
        expect(await milp.balanceOf(user1.address)).eq(0)
        expect(await eth.balanceOf(user1.address)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await eth.balanceOf(user1.address)).lt(expandDecimals(4, 18)) // 4 WETH

        await increaseTime(provider, 24 * 60 * 60)
        await mineBlock(provider)

        await rewardRouter.connect(user1).handleRewards(
            false // _shouldConvertWethToEth
        )

        expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(35, 17)) // 3.5 WETH
        expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(4, 18)) // 4 WETH

        // expect(await bnGmx.balanceOf(user1.address)).eq(0)
        expect(await milp.balanceOf(user1.address)).eq(0)

        expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18)) // 7 WETH
        expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18)) // 8 WETH
    })
})
