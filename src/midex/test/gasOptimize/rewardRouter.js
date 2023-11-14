const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, getBnbConfig, getEthConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('../core/Vault/helpers')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')
const { sleep } = require('../../scripts/shared/helpers')

use(solidity)

describe('BuyMILP', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, tokenManager] = provider.getWallets()

    const vestingDuration = 365 * 24 * 60 * 60

    let vaultPriceFeed

    beforeEach(async () => {
        // bnb = await deployContract("Token", [])
        btc = await deployContract('Token', [])
        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])
        usdc = await deployContract('Token', [])
        busd = await deployContract('Token', [])
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

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, eth.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])
        milp = await deployContract('MILP', [])
        rewardRouter = await deployContract('RewardRouter', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        distributor0 = await deployContract('TimeDistributor', [])
        yieldTracker0 = await deployContract('YieldTracker', [musd.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [eth.address])

        await eth.mint(distributor0.address, 5000)
        await musd.setYieldTrackers([yieldTracker0.address])

        // deploy miOracle
        miOracle = await deployMiOracle(eth)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, eth.address, 0])

        // deposit req fund to fulfillController
        await eth.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set fulfillController
        await fulfillController.setController(wallet.address, true)
        await fulfillController.setHandler(milpManager.address, true)

        // set milpManager
        await milpManager.setFulfillController(fulfillController.address)

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        // await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT
        await vaultPriceFeed.setTokenConfig(busd.address, busdPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(usdc.address, usdcPriceFeed.address, 8, false)

        // set vault
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(eth))

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)

        await vault.setInManagerMode(true)

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)

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

        await fulfillController.setHandler(rewardRouter.address, true)
        await rewardRouter.setFulfillController(fulfillController.address)
        await milpManager.setHandler(rewardRouter.address, true)

        await milpManager.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(milpManager.address)
        await feeMilpTracker.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(feeMilpTracker.address)

        await rewardManager.enableRewardRouter()
    })
    it('BuyMILP by rewardRouter', async () => {
        for (let i = 0; i < 10; i++) {
            await eth.mint(feeMilpDistributor.address, expandDecimals(100, 18))
            await feeMilpDistributor.setTokensPerInterval('41335970000000') // 0.00004133597 ETH per second

            await eth.mint(user1.address, expandDecimals(1, 18))
            await eth.connect(user1).approve(rewardRouter.address, expandDecimals(1, 18))

            const tx0 = await rewardRouter.connect(user1).mintAndStakeMilp(eth.address, expandDecimals(1, 18), expandDecimals(299, 18), expandDecimals(299, 18))

            await reportGasUsed(provider, tx0, 'mintAndStakeMilp gas used')
            await sleep(1000)

            await miOracle.fulfillRequest(
                [
                    { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(300), lastUpdate: 0 },
                ],
                0
            )
        }
    })
})
