const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, getBnbConfig, getEthConfig, getBtcConfig, getDaiConfig, validateVaultBalance, tokenIndexes } = require('../core/Vault/helpers')
const { sleep } = require('../../scripts/shared/helpers')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')

use(solidity)

describe('BuyMILP', function () {
    const provider = waffle.provider
    const [deployer, wallet, user0, user1, user2] = provider.getWallets()

    let vaultPriceFeed

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        eth = await deployContract('Token', [])
        dai = await deployContract('Token', [])
        usdc = await deployContract('Token', [])
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

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])
        await fulfillController.setController(deployer.address, true)

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set fulfillController
        await fulfillController.setController(deployer.address, true)
        await fulfillController.setHandler(milpManager.address, true)

        // set milpManager
        await milpManager.setFulfillController(fulfillController.address)

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT
        await vaultPriceFeed.setTokenConfig(busd.address, busdPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(usdc.address, usdcPriceFeed.address, 8, false)

        // set vault
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)

        await vault.setInManagerMode(true)
    })

    it('BuyMILP by milpManager', async () => {
        await vault.setManager(milpManager.address, true)

        for (let i = 0; i < 10; i++) {
            await dai.mint(user0.address, expandDecimals(100, 18))
            await dai.connect(user0).approve(milpManager.address, expandDecimals(100, 18))
            await fulfillController.requestUpdatePrices()
            await miOracle.fulfillRequest(
                [
                    { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(1500), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BUSD, price: toMiOraclePrice(1), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.USDC, price: toMiOraclePrice(1), lastUpdate: 0 },
                    { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
                ],
                0
            )

            const tx0 = await milpManager.connect(user0).addLiquidity(dai.address, expandDecimals(100, 18), expandDecimals(99, 18), expandDecimals(99, 18))
            await reportGasUsed(provider, tx0, 'addLiquidity gas used')
            await sleep(1000)
        }
    })
})
