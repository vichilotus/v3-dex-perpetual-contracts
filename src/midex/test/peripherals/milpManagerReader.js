const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, getBnbConfig, getEthConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('../core/Vault/helpers')

use(solidity)

describe('MILPManagerReader', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let vault
    let musd
    let router
    let btc
    let eth
    let bnb
    let busd
    let milpManagerReader
    let miOracle
    let fulfillController

    beforeEach(async () => {
        bnb = await deployContract('Token', [])
        btc = await deployContract('Token', [])
        eth = await deployContract('Token', [])
        busd = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, bnb.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])
        milp = await deployContract('MILP', [])

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)
        milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 24 * 60 * 60])

        await musd.addVault(milpManager.address)

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)
        const [btcPriceFeed, ethPriceFeed, bnbPriceFeed, usdtPriceFeed, busdPriceFeed, usdcPriceFeed] = await getPriceFeed()

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(busd.address, busdPriceFeed.address, 8, false) // instead DAI with USDT

        // set fulfillController
        await fulfillController.setController(wallet.address, true)
        await fulfillController.setHandler(milpManager.address, true)

        // set milpManager
        await milpManager.setFulfillController(fulfillController.address)

        milpManagerReader = await deployContract('MILPManagerReader', [])

        // set vault
        await vault.setTokenConfig(...getDaiConfig(busd))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getEthConfig(eth))
        await vault.setTokenConfig(...getBnbConfig(bnb))

        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(4000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BUSD, price: toMiOraclePrice(1), lastUpdate: 0 },
            ],
            0
        )

        await milp.setInPrivateTransferMode(true)
        await milp.setMinter(milpManager.address, true)

        await vault.setManager(milpManager.address, true)
        await vault.setInManagerMode(true)
    })

    it('getAum', async () => {
        await btc.mint(user2.address, '100000000') // 1 BTC
        await btc.connect(user2).approve(milpManager.address, '100000000')

        await milpManager.connect(user2).addLiquidity(btc.address, '100000000', 0, 0)

        await increaseBlockTime(provider, 10)

        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(60000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.ETH, price: toMiOraclePrice(4000), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(300), lastUpdate: 0 },
                { tokenIndex: tokenIndexes.BUSD, price: toMiOraclePrice(1), lastUpdate: 0 },
            ],
            0
        )

        const result1 = await milpManager.getAum(true, false)

        console.log(`milpManager.getAum: ${result1}`)
        expect(result1).eq('59820000000000000000000000000000000') // 59,820 = (1 BTC * 60,000) - fee

        // function getAum(address milpManager, address vault, LastPrice[] memory lastPrice) external view returns (uint256)
        const result2 = await milpManagerReader.getAum(milpManager.address, vault.address, [
            [btc.address, '60000000000000000000000000000000000'],
            [eth.address, '4000000000000000000000000000000000'],
            [bnb.address, '300000000000000000000000000000000'],
            [busd.address, '1000000000000000000000000000000'],
        ])
        console.log(`milpManagerReader.getAum: ${result2}`)
        expect(result2).eq(result1)
    })
})
