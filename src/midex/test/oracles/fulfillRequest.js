const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')
const { toUsd } = require('../shared/units')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('../core/Vault/helpers')

use(solidity)

describe('\n📌 ### Test fulfillRequest ###\n', function () {
    const provider = waffle.provider
    const [deployer, handler, controller, user0, user1, user2, liquidator, feeReceiver] = provider.getWallets()
    const { AddressZero } = ethers.constants
    const depositFee = 50
    const minExecutionFeeForPositionRouter = 4000
    let vault
    let vaultPriceFeed
    let positionManager
    let musd
    let router
    let miOracle
    let fulfillController
    let testSwap
    let btc
    let busd
    let bnb
    let orderBook
    let orderBookOpenOrder

    beforeEach('Deploy fulfillController Contract', async function () {
        btc = await deployContract('Token', [])
        busd = await deployContract('Token', [])
        bnb = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        await vault.setIsLeverageEnabled(false)
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])
        milp = await deployContract('MILP', [])
        positionRouter = await deployContract('PositionRouter', [
            vault.address,
            vaultPositionController.address,
            router.address,
            bnb.address,
            depositFee,
            minExecutionFeeForPositionRouter,
        ])
        rewardRouter = await deployContract('RewardRouter', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])
        testSwap = await deployContract('TestSwapMock', [fulfillController.address, miOracle.address])

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set vault TokenConfig
        await vault.setTokenConfig(...getDaiConfig(busd))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(bnb))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(busd.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

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

        positionManager = await deployContract('PositionManager', [
            vault.address,
            vaultPositionController.address,
            router.address,
            bnb.address,
            50,
            orderBook.address,
        ])

        // setController
        await fulfillController.setController(deployer.address, true)

        // setHandler
        await fulfillController.setHandler(testSwap.address, true)
        await fulfillController.setHandler(handler.address, true)
        await fulfillController.setHandler(router.address, true)
        await fulfillController.setHandler(positionManager.address, true)
        await fulfillController.setHandler(positionRouter.address, true)
        await fulfillController.setHandler(milpManager.address, true)
        await fulfillController.setHandler(rewardRouter.address, true)

        await testSwap.setToken(btc.address, 0, true)
        await testSwap.setToken(busd.address, 4, true)
    })

    it('Test setFulfillController', async function () {
        const account = [user0, user1, user2].at(random(3))

        // Account = user0, user1, user2
        await expect(positionManager.connect(account).setFulfillController(fulfillController.address)).to.be.revertedWith('BasePositionManager: forbidden')
        await expect(router.connect(account).setFulfillController(fulfillController.address)).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${account.address}")`
        )
        await expect(positionRouter.connect(account).setFulfillController(fulfillController.address, deployer.address)).to.be.revertedWith(
            'BasePositionManager: forbidden'
        )
        await expect(milpManager.connect(account).setFulfillController(fulfillController.address)).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${account.address}")`
        )
        await expect(rewardRouter.connect(account).setFulfillController(fulfillController.address)).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${account.address}")`
        )
        await expect(orderBook.connect(account).setFulfillController(fulfillController.address)).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${account.address}")`
        )

        // Deployer
        await positionManager.connect(deployer).setFulfillController(fulfillController.address)
        await router.connect(deployer).setFulfillController(fulfillController.address)
        await positionRouter.connect(deployer).setFulfillController(fulfillController.address, deployer.address)
        await milpManager.connect(deployer).setFulfillController(fulfillController.address)
        await rewardRouter.connect(deployer).setFulfillController(fulfillController.address)
        await orderBook.connect(deployer).setFulfillController(fulfillController.address)
    })

    it('Test fulfill Orderbook', async function () {
        await expect(
            orderBook
                .connect(user0)
                .fulfillCreateIncreaseOrder(
                    user0.address,
                    [busd.address, btc.address],
                    expandDecimals(1000, 18),
                    btc.address,
                    0,
                    toUsd(2000),
                    btc.address,
                    true,
                    toUsd(59000),
                    true,
                    500000
                )
        ).to.be.revertedWith('FulfillController: forbidden')

        await orderBook.connect(deployer).setFulfillController(user0.address)

        await expect(
            orderBook
                .connect(user0)
                .fulfillCreateIncreaseOrder(
                    user0.address,
                    [busd.address, btc.address],
                    expandDecimals(1000, 18),
                    btc.address,
                    0,
                    toUsd(2000),
                    btc.address,
                    true,
                    toUsd(59000),
                    true,
                    500000
                )
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
    })

    it('Test fulfill PositionManger', async function () {
        await expect(positionManager.connect(user0).fulfillExecuteOrders(feeReceiver.address)).to.be.revertedWith('FulfillController: forbidden')

        await expect(
            positionManager.connect(user0).fulfillLiquidatePosition(user0.address, busd.address, btc.address, true, feeReceiver.address)
        ).to.be.revertedWith('FulfillController: forbidden')

        await positionManager.connect(deployer).setFulfillController(user0.address)

        await expect(positionManager.connect(user0).fulfillExecuteOrders(feeReceiver.address)).to.not.reverted
        await expect(
            positionManager.connect(user0).fulfillLiquidatePosition(user0.address, busd.address, btc.address, true, feeReceiver.address)
        ).to.be.revertedWith('function call to a non-contract account')
    })

    it('Test fulfill Router', async function () {
        await expect(
            router.connect(user0).fulfillSwap(user0.address, [busd.address, musd.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address)
        ).to.be.revertedWith('FulfillController: forbidden')

        // fulfillSwapTokensToETH(address,address[],uint256,uint256,address)", owner, _path, _amountIn, _minOut, _receiver
        await expect(
            router
                .connect(user0)
                .fulfillSwapTokensToETH(user0.address, [busd.address, musd.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address)
        ).to.be.revertedWith('FulfillController: forbidden')

        await router.connect(deployer).setFulfillController(user0.address)

        await expect(
            router.connect(user0).fulfillSwap(user0.address, [busd.address, musd.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address)
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
        await expect(
            router
                .connect(user0)
                .fulfillSwapTokensToETH(user0.address, [busd.address, musd.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address)
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
    })

    it('Test RewardRouter', async function () {
        await expect(
            rewardRouter
                .connect(user0)
                .fulfillMintAndStakeMilp(user0.address, bnb.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))
        ).to.be.revertedWith('FulfillController: forbidden')
        await expect(
            rewardRouter.connect(user0).fulfillUnStakeAndRedeemMilp(user0.address, bnb.address, expandDecimals(299, 18), '990000000000000000', user2.address)
        ).to.be.revertedWith('FulfillController: forbidden')

        await expect(
            rewardRouter.connect(user0).fulfillUnStakeAndRedeemMilpETH(user0.address, expandDecimals(299, 18), '990000000000000000', user2.address)
        ).to.be.revertedWith('FulfillController: forbidden')

        await rewardRouter.connect(deployer).setFulfillController(user0.address)

        await expect(
            rewardRouter
                .connect(user0)
                .fulfillMintAndStakeMilp(user0.address, bnb.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
        await expect(
            rewardRouter.connect(user0).fulfillUnStakeAndRedeemMilp(user0.address, bnb.address, expandDecimals(299, 18), '990000000000000000', user2.address)
        ).to.be.revertedWith('function call to a non-contract account')
        await expect(
            rewardRouter.connect(user0).fulfillUnStakeAndRedeemMilpETH(user0.address, expandDecimals(299, 18), '990000000000000000', user2.address)
        ).to.be.revertedWith('function call to a non-contract account')
    })
})

function random(max) {
    return Math.floor(Math.random() * max)
}
