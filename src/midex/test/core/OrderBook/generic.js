const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../../shared/fixtures')
const { expandDecimals, increaseBlockTime, getBlockTime } = require('../../shared/utilities')
const { toMiOraclePrice } = require('../../shared/chainLink')
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, tokenIndexes } = require('../Vault/helpers')

use(solidity)

const BTC_PRICE = 60000
const BNB_PRICE = 300

describe('OrderBook', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()

    let orderBook
    let orderBookOpenOrder

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

        await initVault(vault, vaultPositionController, router, musd, vaultPriceFeed)

        distributor0 = await deployContract('TimeDistributor', [])
        yieldTracker0 = await deployContract('YieldTracker', [musd.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)
        await musd.setYieldTrackers([yieldTracker0.address])

        reader = await deployContract('Reader', [])

        // set vault
        await vault.setTokenConfig(...getDaiConfig(dai))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(bnb))

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

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).approve(router.address, expandDecimals(100, 8))

        await dai.mint(user0.address, expandDecimals(10000000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(1000000, 18))

        await dai.mint(user0.address, expandDecimals(20000000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
        await vault.directPoolDeposit(dai.address)

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8))
        await vault.directPoolDeposit(btc.address)

        await bnb.mint(user0.address, expandDecimals(10000, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await vault.directPoolDeposit(bnb.address)
    })

    it('transferGovernance', async () => {
        await expect(orderBook.connect(user0).transferGovernance(user1.address)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        expect(await orderBook.governor()).eq(wallet.address)

        await orderBook.transferGovernance(user0.address)
        await orderBook.connect(user0).acceptGovernance()
        expect(await orderBook.governor()).eq(user0.address)

        await orderBook.connect(user0).transferGovernance(user1.address)
        await orderBook.connect(user1).acceptGovernance()
        expect(await orderBook.governor()).eq(user1.address)
    })

    it('set*', async () => {
        const cases = [
            ['setMinExecutionFee', 600000],
            ['setMinPurchaseTokenAmountUsd', 1],
        ]
        for (const [name, arg] of cases) {
            await expect(orderBook.connect(user1)[name](arg)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user1.address}")`)
            await expect(orderBook[name](arg))
        }
    })

    it('initialize, already initialized', async () => {
        await expect(
            orderBook.connect(user1).initialize(
                router.address,
                vault.address,
                vaultPositionController.address,
                orderBookOpenOrder.address,
                bnb.address,
                musd.address,
                1,
                expandDecimals(5, 30) // minPurchaseTokenAmountUsd
            )
        ).to.be.revertedWith(`GovernableUnauthorizedAccount("${user1.address}")`)

        await expect(
            orderBook.initialize(
                router.address,
                vault.address,
                vaultPositionController.address,
                orderBookOpenOrder.address,
                bnb.address,
                musd.address,
                1,
                expandDecimals(5, 30) // minPurchaseTokenAmountUsd
            )
        ).to.be.revertedWith('already initialized') // OrderBook: already initialized
    })
})
