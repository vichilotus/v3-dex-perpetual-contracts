const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, increaseBlockTime, reportGasUsed } = require('../shared/utilities')
const { toMiOraclePrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')
const { initVault, tokenIndexes } = require('../core/Vault/helpers')
const { deployMiOracle, getPriceFeed } = require('../shared/miOracle')

use(solidity)

const { AddressZero } = ethers.constants

describe('TimeLock', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3, rewardManager, tokenManager, mintReceiver, positionRouter] = provider.getWallets()
    let vault
    let vaultUtils
    let vaultPriceFeed
    let musd
    let router
    let bnb
    let btc
    let dai

    let distributor0
    let yieldTracker0
    let timeLock
    let btcPriceFeed
    let ethPriceFeed
    let bnbPriceFeed
    let usdtPriceFeed
    let busdPriceFeed
    let usdcPriceFeed
    let fulfillController

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
        vaultUtils = initVaultResult.vaultUtils

        distributor0 = await deployContract('TimeDistributor', [])
        yieldTracker0 = await deployContract('YieldTracker', [musd.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)
        await musd.setYieldTrackers([yieldTracker0.address])

        // deploy miOracle
        miOracle = await deployMiOracle(bnb)

        const priceFeed = await getPriceFeed()
        btcPriceFeed = priceFeed[0]
        ethPriceFeed = priceFeed[1]
        bnbPriceFeed = priceFeed[2]
        usdtPriceFeed = priceFeed[3]
        busdPriceFeed = priceFeed[4]
        usdcPriceFeed = priceFeed[5]

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, bnb.address, 0])
        await fulfillController.setController(wallet.address, true)

        // deposit req fund to fulfillController
        await bnb.mint(fulfillController.address, ethers.utils.parseEther('1.0'))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, usdtPriceFeed.address, 8, false) // instead DAI with USDT

        await vault.setPriceFeed(user3.address)

        timeLock = await deployContract('TimeLock', [
            wallet.address,
            5 * 24 * 60 * 60,
            rewardManager.address,
            tokenManager.address,
            mintReceiver.address,
            expandDecimals(1000, 18),
            50, // marginFeeBasisPoints 0.5%
            500, // maxMarginFeeBasisPoints 5%
        ])
        await vault.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        await vaultPriceFeed.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vaultPriceFeed.address)
        await router.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(router.address)
    })

    it('inits', async () => {
        expect(await musd.governor()).eq(wallet.address)
        expect(await musd.vaults(vault.address)).eq(true)
        expect(await musd.vaults(user0.address)).eq(false)

        expect(await vault.governor()).eq(timeLock.address)
        expect(await vault.isInitialized()).eq(true)
        expect(await vault.router()).eq(router.address)
        expect(await vault.musd()).eq(musd.address)
        expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
        expect(await vault.fundingRateFactor()).eq(600)

        expect(await timeLock.admin()).eq(wallet.address)
        expect(await timeLock.buffer()).eq(5 * 24 * 60 * 60)
        expect(await timeLock.tokenManager()).eq(tokenManager.address)
        expect(await timeLock.maxTokenSupply()).eq(expandDecimals(1000, 18))

        await expect(
            deployContract('TimeLock', [wallet.address, 5 * 24 * 60 * 60 + 1, rewardManager.address, tokenManager.address, mintReceiver.address, 1000, 10, 100])
        ).to.be.revertedWith('TimeLock: invalid _buffer')
    })

    it('setTokenConfig', async () => {
        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
        await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
        await mineBlock(provider)
        await timeLock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await expect(timeLock.connect(user0).setTokenConfig(vault.address, bnb.address, 100, 200, 1000, 0, 0)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).setTokenConfig(vault.address, bnb.address, 100, 200, 1000, 0, 0)).to.be.revertedWith(
            'TimeLock: token not yet whitelisted'
        )

        await timeLock.connect(wallet).signalVaultSetTokenConfig(
            vault.address,
            bnb.address, // _token
            12, // _tokenDecimals
            7000, // _tokenWeight
            300, // _minProfitBps
            5000, // _maxMusdAmount
            false, // _isStable
            true // isShortable
        )

        await increaseTime(provider, 5 * 24 * 60 * 60)
        await mineBlock(provider)

        await timeLock.connect(wallet).vaultSetTokenConfig(
            vault.address,
            bnb.address, // _token
            12, // _tokenDecimals
            7000, // _tokenWeight
            300, // _minProfitBps
            5000, // _maxMusdAmount
            false, // _isStable
            true // isShortable
        )

        expect(await vault.whitelistedTokenCount()).eq(1)
        expect(await vault.totalTokenWeights()).eq(7000)
        expect(await vault.whitelistedTokens(bnb.address)).eq(true)
        expect(await vault.tokenDecimals(bnb.address)).eq(12)
        expect(await vault.tokenWeights(bnb.address)).eq(7000)
        expect(await vault.minProfitBasisPoints(bnb.address)).eq(300)
        expect(await vault.maxMusdAmounts(bnb.address)).eq(5000)
        expect(await vault.stableTokens(bnb.address)).eq(false)
        expect(await vault.shortableTokens(bnb.address)).eq(true)

        await timeLock.connect(wallet).setTokenConfig(
            vault.address,
            bnb.address,
            100, // _tokenWeight
            200, // _minProfitBps
            1000, // _maxMusdAmount
            300, // _bufferAmount
            500 // _musdAmount
        )

        expect(await vault.whitelistedTokenCount()).eq(1)
        expect(await vault.totalTokenWeights()).eq(100)
        expect(await vault.whitelistedTokens(bnb.address)).eq(true)
        expect(await vault.tokenDecimals(bnb.address)).eq(12)
        expect(await vault.tokenWeights(bnb.address)).eq(100)
        expect(await vault.minProfitBasisPoints(bnb.address)).eq(200)
        expect(await vault.maxMusdAmounts(bnb.address)).eq(1000)
        expect(await vault.stableTokens(bnb.address)).eq(false)
        expect(await vault.shortableTokens(bnb.address)).eq(true)
        expect(await vault.bufferAmounts(bnb.address)).eq(300)
        expect(await vault.musdAmounts(bnb.address)).eq(500)

        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(user0).setTokenConfig(
            vault.address,
            bnb.address,
            100, // _tokenWeight
            50, // _minProfitBps
            1000, // _maxMusdAmount
            300, // _bufferAmount
            500 // _musdAmount
        )

        expect(await vault.minProfitBasisPoints(bnb.address)).eq(50)
    })

    it('setBuffer', async () => {
        const timeLock0 = await deployContract('TimeLock', [
            user1.address,
            3 * 24 * 60 * 60,
            rewardManager.address,
            tokenManager.address,
            mintReceiver.address,
            1000,
            10,
            100,
        ])
        await expect(timeLock0.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock0.connect(user1).setBuffer(5 * 24 * 60 * 60 + 10)).to.be.revertedWith('TimeLock: invalid _buffer')

        await expect(timeLock0.connect(user1).setBuffer(3 * 24 * 60 * 60 - 10)).to.be.revertedWith('TimeLock: buffer cannot be decreased')

        expect(await timeLock0.buffer()).eq(3 * 24 * 60 * 60)
        await timeLock0.connect(user1).setBuffer(3 * 24 * 60 * 60 + 10)
        expect(await timeLock0.buffer()).eq(3 * 24 * 60 * 60 + 10)
    })

    it('setMaxStrictPriceDeviation', async () => {
        await expect(timeLock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(0)
        await timeLock.connect(wallet).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100)
        expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(100)

        await timeLock.setContractHandler(user0.address, true)
        await timeLock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 200)
        expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(200)
    })

    it('setPriceSampleSpace', async () => {
        await expect(timeLock.connect(user0).setPriceSampleSpaceTime(vaultPriceFeed.address, 0)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vaultPriceFeed.priceSampleSpaceTime()).eq(30)
        await timeLock.connect(wallet).setPriceSampleSpaceTime(vaultPriceFeed.address, 10)
        expect(await vaultPriceFeed.priceSampleSpaceTime()).eq(10)
    })

    it('setIsSwapEnabled', async () => {
        await expect(timeLock.connect(user0).setIsSwapEnabled(vault.address, false)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.isSwapEnabled()).eq(true)
        await timeLock.connect(wallet).setIsSwapEnabled(vault.address, false)
        expect(await vault.isSwapEnabled()).eq(false)
    })

    it('setContractHandler', async () => {
        await expect(timeLock.connect(user0).setContractHandler(user1.address, true)).to.be.revertedWith('TimeLock: forbidden')

        expect(await timeLock.isHandler(user1.address)).eq(false)
        await timeLock.connect(wallet).setContractHandler(user1.address, true)
        expect(await timeLock.isHandler(user1.address)).eq(true)
    })

    it('setIsLeverageEnabled', async () => {
        await expect(timeLock.connect(user0).setIsLeverageEnabled(vault.address, false)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.isLeverageEnabled()).eq(true)
        await timeLock.connect(wallet).setIsLeverageEnabled(vault.address, false)
        expect(await vault.isLeverageEnabled()).eq(false)

        await timeLock.connect(wallet).setIsLeverageEnabled(vault.address, true)
        expect(await vault.isLeverageEnabled()).eq(true)

        await expect(timeLock.connect(user1).addExcludedToken(user2.address)).to.be.revertedWith('TimeLock: forbidden')
    })

    it('setMaxGlobalShortSize', async () => {
        await expect(timeLock.connect(user0).setMaxGlobalShortSize(vault.address, bnb.address, 100)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.maxGlobalShortSizes(bnb.address)).eq(0)
        await timeLock.connect(wallet).setMaxGlobalShortSize(vault.address, bnb.address, 100)
        expect(await vault.maxGlobalShortSizes(bnb.address)).eq(100)
    })

    it('setMaxGasPrice', async () => {
        await expect(timeLock.connect(user0).setMaxGasPrice(vault.address, 7000000000)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.maxGasPrice()).eq(0)
        await timeLock.connect(wallet).setMaxGasPrice(vault.address, 7000000000)
        expect(await vault.maxGasPrice()).eq(7000000000)
    })

    it('setMaxLeverage', async () => {
        await expect(timeLock.connect(user0).setMaxLeverage(vault.address, 100 * 10000)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).setMaxLeverage(vault.address, 49 * 10000)).to.be.revertedWith('TimeLock: invalid _maxLeverage')

        expect(await vault.maxLeverage()).eq(50 * 10000)
        await timeLock.connect(wallet).setMaxLeverage(vault.address, 100 * 10000)
        expect(await vault.maxLeverage()).eq(100 * 10000)
    })

    it('setFundingRate', async () => {
        await expect(timeLock.connect(user0).setFundingRate(vault.address, 59 * 60, 100, 100)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).setFundingRate(vault.address, 59 * 60, 100, 100)).to.be.revertedWith('Vault: invalid _fundingInterval')

        expect(await vault.fundingRateFactor()).eq(600)
        expect(await vault.stableFundingRateFactor()).eq(600)
        await timeLock.connect(wallet).setFundingRate(vault.address, 60 * 60, 0, 100)
        expect(await vault.fundingRateFactor()).eq(0)
        expect(await vault.stableFundingRateFactor()).eq(100)

        await timeLock.connect(wallet).setFundingRate(vault.address, 60 * 60, 100, 0)
        expect(await vault.fundingInterval()).eq(60 * 60)
        expect(await vault.fundingRateFactor()).eq(100)
        expect(await vault.stableFundingRateFactor()).eq(0)

        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(user0).setFundingRate(vault.address, 120 * 60, 50, 75)
        expect(await vault.fundingInterval()).eq(120 * 60)
        expect(await vault.fundingRateFactor()).eq(50)
        expect(await vault.stableFundingRateFactor()).eq(75)
    })

    it('transferIn', async () => {
        await bnb.mint(user1.address, 1000)
        await expect(timeLock.connect(user0).transferIn(user1.address, bnb.address, 1000)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).transferIn(user1.address, bnb.address, 1000)).to.be.revertedWith('ERC20: transfer amount exceeds allowance')

        await bnb.connect(user1).approve(timeLock.address, 1000)

        expect(await bnb.balanceOf(user1.address)).eq(1000)
        expect(await bnb.balanceOf(timeLock.address)).eq(0)
        await timeLock.connect(wallet).transferIn(user1.address, bnb.address, 1000)
        expect(await bnb.balanceOf(user1.address)).eq(0)
        expect(await bnb.balanceOf(timeLock.address)).eq(1000)
    })

    it('approve', async () => {
        await timeLock.setContractHandler(user0.address, true)
        await expect(timeLock.connect(user0).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(user0).signalApprove(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith(
            'TimeLock: action time not yet passed'
        )

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith(
            'TimeLock: action time not yet passed'
        )

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).approve(bnb.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(wallet).approve(dai.address, user2.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(101, 18))).to.be.revertedWith('TimeLock: action not signalled')

        await dai.mint(timeLock.address, expandDecimals(150, 18))

        expect(await dai.balanceOf(timeLock.address)).eq(expandDecimals(150, 18))
        expect(await dai.balanceOf(user1.address)).eq(0)

        await expect(dai.connect(user1).transferFrom(timeLock.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith(
            'ERC20: transfer amount exceeds allowance'
        )

        await timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))
        await expect(dai.connect(user2).transferFrom(timeLock.address, user2.address, expandDecimals(100, 18))).to.be.revertedWith(
            'ERC20: transfer amount exceeds allowance'
        )
        await dai.connect(user1).transferFrom(timeLock.address, user1.address, expandDecimals(100, 18))

        expect(await dai.balanceOf(timeLock.address)).eq(expandDecimals(50, 18))
        expect(await dai.balanceOf(user1.address)).eq(expandDecimals(100, 18))

        await expect(dai.connect(user1).transferFrom(timeLock.address, user1.address, expandDecimals(1, 18))).to.be.revertedWith(
            'ERC20: transfer amount exceeds allowance'
        )

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: action not signalled')

        await timeLock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith(
            'TimeLock: action time not yet passed'
        )

        const action0 = ethers.utils.solidityKeccak256(
            ['string', 'address', 'address', 'uint256'],
            ['approve', bnb.address, user1.address, expandDecimals(100, 18)]
        )
        const action1 = ethers.utils.solidityKeccak256(
            ['string', 'address', 'address', 'uint256'],
            ['approve', dai.address, user1.address, expandDecimals(100, 18)]
        )

        await expect(timeLock.connect(user0).cancelAction(action0)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')

        await timeLock.connect(wallet).cancelAction(action1)

        await expect(timeLock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith('TimeLock: action not signalled')
    })

    it('processMint', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).processMint(bnb.address, user1.address, expandDecimals(100, 18))).to.be.revertedWith(
            'TimeLock: action not signalled'
        )

        const action0 = ethers.utils.solidityKeccak256(
            ['string', 'address', 'address', 'uint256'],
            ['mint', bnb.address, user1.address, expandDecimals(100, 18)]
        )

        await expect(timeLock.connect(user0).cancelAction(action0)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')
    })

    it('setHandler', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        const action0 = ethers.utils.solidityKeccak256(['string', 'address', 'address', 'bool'], ['setHandler', bnb.address, user1.address, true])

        await expect(timeLock.connect(user0).cancelAction(action0)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')
    })

    it('transferGovernance', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await expect(timeLock.connect(user0).transferGovernance(vault.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(user0).signalTransferGovernance(vault.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalTransferGovernance(vault.address, user1.address)

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).transferGovernance(user2.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')

        expect(await vault.governor()).eq(timeLock.address)
        await timeLock.connect(wallet).transferGovernance(vault.address, user1.address)
        await vault.connect(user1).acceptGovernance()
        expect(await vault.governor()).eq(user1.address)

        await timeLock.connect(wallet).signalTransferGovernance(vault.address, user2.address)

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user2.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        const action0 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['transferGovernance', user1.address, user2.address])
        const action1 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['transferGovernance', vault.address, user2.address])

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')

        await timeLock.connect(wallet).cancelAction(action1)

        await expect(timeLock.connect(wallet).transferGovernance(vault.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')
    })

    it('setPriceFeed', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await expect(timeLock.connect(user0).setPriceFeed(vault.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(user0).signalSetPriceFeed(vault.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, user1.address)

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).setPriceFeed(user2.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')

        expect(await vault.priceFeed()).eq(user3.address)
        await timeLock.connect(wallet).setPriceFeed(vault.address, user1.address)
        expect(await vault.priceFeed()).eq(user1.address)

        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, user2.address)

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user2.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        const action0 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['setPriceFeed', user1.address, user2.address])
        const action1 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['setPriceFeed', vault.address, user2.address])

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')

        await timeLock.connect(wallet).cancelAction(action1)

        await expect(timeLock.connect(wallet).setPriceFeed(vault.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')
    })

    it('withdrawToken', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).withdrawToken(dai.address, bnb.address, user0.address, 100)).to.be.revertedWith('TimeLock: action not signalled')

        expect(await bnb.balanceOf(user0.address)).eq(0)
    })

    it('vaultSetTokenConfig', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
        await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
        await mineBlock(provider)
        await timeLock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest(
            [
                { tokenIndex: tokenIndexes.USDT, price: toMiOraclePrice(1), lastUpdate: (await getBlockTime(provider)) + 24 * 60 * 60 }, // set permanent price
            ],
            0
        )

        await expect(
            timeLock.connect(user0).vaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                12, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        await expect(
            timeLock.connect(wallet).vaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                12, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(user0).signalVaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                12, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalVaultSetTokenConfig(
            vault.address,
            dai.address, // _token
            12, // _tokenDecimals
            7000, // _tokenWeight
            120, // _minProfitBps
            5000, // _maxMusdAmount
            true, // _isStable
            false // isShortable
        )

        await expect(
            timeLock.connect(wallet).vaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                12, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(
            timeLock.connect(wallet).vaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                12, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(
            timeLock.connect(wallet).vaultSetTokenConfig(
                vault.address,
                dai.address, // _token
                15, // _tokenDecimals
                7000, // _tokenWeight
                120, // _minProfitBps
                5000, // _maxMusdAmount
                true, // _isStable
                false // isShortable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        expect(await vault.totalTokenWeights()).eq(0)
        expect(await vault.whitelistedTokens(dai.address)).eq(false)
        expect(await vault.tokenDecimals(dai.address)).eq(0)
        expect(await vault.tokenWeights(dai.address)).eq(0)
        expect(await vault.minProfitBasisPoints(dai.address)).eq(0)
        expect(await vault.maxMusdAmounts(dai.address)).eq(0)
        expect(await vault.stableTokens(dai.address)).eq(false)
        expect(await vault.shortableTokens(dai.address)).eq(false)

        await timeLock.connect(wallet).vaultSetTokenConfig(
            vault.address,
            dai.address, // _token
            12, // _tokenDecimals
            7000, // _tokenWeight
            120, // _minProfitBps
            5000, // _maxMusdAmount
            true, // _isStable
            false // isShortable
        )

        expect(await vault.totalTokenWeights()).eq(7000)
        expect(await vault.whitelistedTokens(dai.address)).eq(true)
        expect(await vault.tokenDecimals(dai.address)).eq(12)
        expect(await vault.tokenWeights(dai.address)).eq(7000)
        expect(await vault.minProfitBasisPoints(dai.address)).eq(120)
        expect(await vault.maxMusdAmounts(dai.address)).eq(5000)
        expect(await vault.stableTokens(dai.address)).eq(true)
        expect(await vault.shortableTokens(dai.address)).eq(false)
    })

    it('priceFeedSetTokenConfig', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
        await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
        await mineBlock(provider)
        await timeLock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BTC, price: toMiOraclePrice(70000), lastUpdate: 0 }], 0)

        await expect(
            timeLock.connect(user0).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(user0).signalPriceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalPriceFeedSetTokenConfig(
            vaultPriceFeed.address,
            btc.address, // _token
            btcPriceFeed.address, // _priceFeed
            8, // _priceDecimals
            true // _isStrictStable
        )

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                user0.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                bnb.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                bnbPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                9, // _priceDecimals
                true // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        await expect(
            timeLock.connect(wallet).priceFeedSetTokenConfig(
                vaultPriceFeed.address,
                btc.address, // _token
                btcPriceFeed.address, // _priceFeed
                8, // _priceDecimals
                false // _isStrictStable
            )
        ).to.be.revertedWith('TimeLock: action not signalled')

        expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(0)
        expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(false)

        await timeLock.connect(wallet).priceFeedSetTokenConfig(
            vaultPriceFeed.address,
            btc.address, // _token
            btcPriceFeed.address, // _priceFeed
            8, // _priceDecimals
            true // _isStrictStable
        )

        expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(8)
        expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(true)

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT], 10, 3)

        expect(await vaultPriceFeed.getPrice(btc.address, true, false)).eq(toNormalizedPrice(70000))
    })

    it('addPlugin', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await expect(timeLock.connect(user0).addPlugin(router.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).addPlugin(router.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(user0).signalAddPlugin(router.address, user1.address)).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalAddPlugin(router.address, user1.address)

        await expect(timeLock.connect(wallet).addPlugin(router.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 4 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).addPlugin(router.address, user1.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).addPlugin(user2.address, user1.address)).to.be.revertedWith('TimeLock: action not signalled')

        await expect(timeLock.connect(wallet).addPlugin(router.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')

        expect(await router.plugins(user1.address)).eq(false)
        await timeLock.connect(wallet).addPlugin(router.address, user1.address)
        expect(await router.plugins(user1.address)).eq(true)

        await timeLock.connect(wallet).signalAddPlugin(router.address, user2.address)

        await expect(timeLock.connect(wallet).addPlugin(router.address, user2.address)).to.be.revertedWith('TimeLock: action time not yet passed')

        const action0 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['addPlugin', user1.address, user2.address])
        const action1 = ethers.utils.solidityKeccak256(['string', 'address', 'address'], ['addPlugin', router.address, user2.address])

        await expect(timeLock.connect(wallet).cancelAction(action0)).to.be.revertedWith('TimeLock: invalid _action')

        await timeLock.connect(wallet).cancelAction(action1)

        await expect(timeLock.connect(wallet).addPlugin(router.address, user2.address)).to.be.revertedWith('TimeLock: action not signalled')
    })

    it('setAdmin', async () => {
        await expect(timeLock.setAdmin(user1.address)).to.be.revertedWith('TimeLock: forbidden')

        expect(await timeLock.admin()).eq(wallet.address)
        await timeLock.connect(tokenManager).setAdmin(user1.address)
        expect(await timeLock.admin()).eq(user1.address)
    })

    it('setExternalAdmin', async () => {
        const distributor = await deployContract('RewardDistributor', [user1.address, user2.address])
        await distributor.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(distributor.address)
        await expect(timeLock.connect(user0).setExternalAdmin(distributor.address, user3.address)).to.be.revertedWith('TimeLock: forbidden')

        expect(await distributor.admin()).eq(wallet.address)
        await timeLock.connect(wallet).setExternalAdmin(distributor.address, user3.address)
        expect(await distributor.admin()).eq(user3.address)

        await expect(timeLock.connect(wallet).setExternalAdmin(timeLock.address, user3.address)).to.be.revertedWith('TimeLock: invalid _target')
    })

    it('setShouldToggleIsLeverageEnabled', async () => {
        await expect(timeLock.connect(user0).setShouldToggleIsLeverageEnabled(true)).to.be.revertedWith('TimeLock: forbidden')

        expect(await timeLock.shouldToggleIsLeverageEnabled()).to.be.false
        await expect(timeLock.setShouldToggleIsLeverageEnabled(true))
        expect(await timeLock.shouldToggleIsLeverageEnabled()).to.be.true
        await expect(timeLock.setShouldToggleIsLeverageEnabled(false))
        expect(await timeLock.shouldToggleIsLeverageEnabled()).to.be.false

        await timeLock.setContractHandler(user0.address, true)
        await timeLock.connect(user0).setShouldToggleIsLeverageEnabled(true)
        expect(await timeLock.shouldToggleIsLeverageEnabled()).to.be.true
    })

    it('setMarginFeeBasisPoints', async () => {
        await expect(timeLock.connect(user0).setMarginFeeBasisPoints(100, 1000)).to.be.revertedWith('TimeLock: forbidden')

        expect(await timeLock.marginFeeBasisPoints()).eq(50)
        expect(await timeLock.maxMarginFeeBasisPoints()).eq(500)

        await timeLock.setMarginFeeBasisPoints(100, 1000)
        expect(await timeLock.marginFeeBasisPoints()).eq(100)
        expect(await timeLock.maxMarginFeeBasisPoints()).eq(1000)

        await timeLock.setContractHandler(user0.address, true)
        await timeLock.connect(user0).setMarginFeeBasisPoints(20, 200)
        expect(await timeLock.marginFeeBasisPoints()).eq(20)
        expect(await timeLock.maxMarginFeeBasisPoints()).eq(200)
    })

    it('setFees', async () => {
        await expect(
            timeLock.connect(user0).setFees(
                vault.address,
                1, // _taxBasisPoints,
                2, // _stableTaxBasisPoints,
                3, // _mintBurnFeeBasisPoints,
                4, // _swapFeeBasisPoints,
                5, // _stableSwapFeeBasisPoints,
                6, // _marginFeeBasisPoints,
                7, // _liquidationFeeUsd,
                8, // _minProfitTime,
                false
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.taxBasisPoints()).eq(50)
        expect(await vault.stableTaxBasisPoints()).eq(20)
        expect(await vault.mintBurnFeeBasisPoints()).eq(30)
        expect(await vault.swapFeeBasisPoints()).eq(30)
        expect(await vault.stableSwapFeeBasisPoints()).eq(4)
        expect(await timeLock.marginFeeBasisPoints()).eq(50)
        expect(await vault.marginFeeBasisPoints()).eq(10)
        expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
        expect(await vault.minProfitTime()).eq(0)
        expect(await vault.hasDynamicFees()).eq(false)

        await timeLock.connect(wallet).setFees(
            vault.address,
            1, // _taxBasisPoints,
            2, // _stableTaxBasisPoints,
            3, // _mintBurnFeeBasisPoints,
            4, // _swapFeeBasisPoints,
            5, // _stableSwapFeeBasisPoints,
            6, // _marginFeeBasisPoints,
            7, // _liquidationFeeUsd,
            8, // _minProfitTime,
            false // _hasDynamicFees
        )

        expect(await vault.taxBasisPoints()).eq(1)
        expect(await vault.stableTaxBasisPoints()).eq(2)
        expect(await vault.mintBurnFeeBasisPoints()).eq(3)
        expect(await vault.swapFeeBasisPoints()).eq(4)
        expect(await vault.stableSwapFeeBasisPoints()).eq(5)
        expect(await timeLock.marginFeeBasisPoints()).eq(6)
        expect(await vault.marginFeeBasisPoints()).eq(500)
        expect(await vault.liquidationFeeUsd()).eq(7)
        expect(await vault.minProfitTime()).eq(8)
        expect(await vault.hasDynamicFees()).eq(false)

        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(wallet).setFees(
            vault.address,
            11, // _taxBasisPoints,
            12, // _stableTaxBasisPoints,
            13, // _mintBurnFeeBasisPoints,
            14, // _swapFeeBasisPoints,
            15, // _stableSwapFeeBasisPoints,
            16, // _marginFeeBasisPoints,
            17, // _liquidationFeeUsd,
            18, // _minProfitTime,
            true // _hasDynamicFees
        )

        expect(await vault.taxBasisPoints()).eq(11)
        expect(await vault.stableTaxBasisPoints()).eq(12)
        expect(await vault.mintBurnFeeBasisPoints()).eq(13)
        expect(await vault.swapFeeBasisPoints()).eq(14)
        expect(await vault.stableSwapFeeBasisPoints()).eq(15)
        expect(await timeLock.marginFeeBasisPoints()).eq(16)
        expect(await vault.marginFeeBasisPoints()).eq(500)
        expect(await vault.liquidationFeeUsd()).eq(17)
        expect(await vault.minProfitTime()).eq(18)
        expect(await vault.hasDynamicFees()).eq(true)
    })

    it('setSwapFees', async () => {
        await expect(
            timeLock.connect(user0).setSwapFees(
                vault.address,
                1, // _taxBasisPoints,
                2, // _stableTaxBasisPoints,
                3, // _mintBurnFeeBasisPoints,
                4, // _swapFeeBasisPoints,
                5 // _stableSwapFeeBasisPoints
            )
        ).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.taxBasisPoints()).eq(50)
        expect(await vault.stableTaxBasisPoints()).eq(20)
        expect(await vault.mintBurnFeeBasisPoints()).eq(30)
        expect(await vault.swapFeeBasisPoints()).eq(30)
        expect(await vault.stableSwapFeeBasisPoints()).eq(4)
        expect(await timeLock.marginFeeBasisPoints()).eq(50)
        expect(await vault.marginFeeBasisPoints()).eq(10)
        expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
        expect(await vault.minProfitTime()).eq(0)
        expect(await vault.hasDynamicFees()).eq(false)

        await timeLock.connect(wallet).setSwapFees(
            vault.address,
            1, // _taxBasisPoints,
            2, // _stableTaxBasisPoints,
            3, // _mintBurnFeeBasisPoints,
            4, // _swapFeeBasisPoints,
            5 // _stableSwapFeeBasisPoints
        )

        expect(await vault.taxBasisPoints()).eq(1)
        expect(await vault.stableTaxBasisPoints()).eq(2)
        expect(await vault.mintBurnFeeBasisPoints()).eq(3)
        expect(await vault.swapFeeBasisPoints()).eq(4)
        expect(await vault.stableSwapFeeBasisPoints()).eq(5)
        expect(await timeLock.marginFeeBasisPoints()).eq(50)
        expect(await vault.marginFeeBasisPoints()).eq(500)
        expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
        expect(await vault.minProfitTime()).eq(0)
        expect(await vault.hasDynamicFees()).eq(false)

        await timeLock.setContractHandler(user0.address, true)

        await timeLock.connect(wallet).setSwapFees(
            vault.address,
            11, // _taxBasisPoints,
            12, // _stableTaxBasisPoints,
            13, // _mintBurnFeeBasisPoints,
            14, // _swapFeeBasisPoints,
            15 // _stableSwapFeeBasisPoints
        )

        expect(await vault.taxBasisPoints()).eq(11)
        expect(await vault.stableTaxBasisPoints()).eq(12)
        expect(await vault.mintBurnFeeBasisPoints()).eq(13)
        expect(await vault.swapFeeBasisPoints()).eq(14)
        expect(await vault.stableSwapFeeBasisPoints()).eq(15)
        expect(await timeLock.marginFeeBasisPoints()).eq(50)
        expect(await vault.marginFeeBasisPoints()).eq(500)
        expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
        expect(await vault.minProfitTime()).eq(0)
        expect(await vault.hasDynamicFees()).eq(false)
    })

    it('toggle leverage', async () => {
        await expect(timeLock.connect(user0).enableLeverage(vault.address)).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.setMarginFeeBasisPoints(10, 100)
        await expect(timeLock.setShouldToggleIsLeverageEnabled(true))
        const initialTaxBasisPoints = await vault.taxBasisPoints()

        expect(await vault.isLeverageEnabled()).to.be.true

        await timeLock.disableLeverage(vault.address)
        expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
        expect(await vault.marginFeeBasisPoints()).eq(100)
        expect(await vault.isLeverageEnabled()).to.be.false

        await timeLock.enableLeverage(vault.address)
        expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
        expect(await vault.marginFeeBasisPoints()).eq(10)
        expect(await vault.isLeverageEnabled()).to.be.true

        await expect(timeLock.setShouldToggleIsLeverageEnabled(false))
        await timeLock.disableLeverage(vault.address)
        expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
        expect(await vault.marginFeeBasisPoints()).eq(100)
        expect(await vault.isLeverageEnabled()).to.be.true

        await expect(timeLock.setShouldToggleIsLeverageEnabled(true))
        await timeLock.disableLeverage(vault.address)
        await expect(timeLock.setShouldToggleIsLeverageEnabled(false))
        await timeLock.enableLeverage(vault.address)
        expect(await vault.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
        expect(await vault.marginFeeBasisPoints()).eq(10)
        expect(await vault.isLeverageEnabled()).to.be.false
    })

    it('setInPrivateLiquidationMode', async () => {
        await expect(timeLock.connect(user0).setInPrivateLiquidationMode(vault.address, true)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.inPrivateLiquidationMode()).eq(false)
        await timeLock.connect(wallet).setInPrivateLiquidationMode(vault.address, true)
        expect(await vault.inPrivateLiquidationMode()).eq(true)

        await timeLock.connect(wallet).setInPrivateLiquidationMode(vault.address, false)
        expect(await vault.inPrivateLiquidationMode()).eq(false)
    })

    it('setLiquidator', async () => {
        await expect(timeLock.connect(user0).setLiquidator(vault.address, user1.address, true)).to.be.revertedWith('TimeLock: forbidden')

        expect(await vault.isLiquidator(user1.address)).eq(false)
        await timeLock.connect(wallet).setLiquidator(vault.address, user1.address, true)
        expect(await vault.isLiquidator(user1.address)).eq(true)

        await timeLock.connect(wallet).setLiquidator(vault.address, user1.address, false)
        expect(await vault.isLiquidator(user1.address)).eq(false)

        await expect(vaultPositionController.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address)).to.be.revertedWith(
            'Vault: empty position'
        )

        await timeLock.connect(wallet).setInPrivateLiquidationMode(vault.address, true)

        await expect(vaultPositionController.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address)).to.be.revertedWith(
            'Vault: invalid liquidator'
        )

        await timeLock.connect(wallet).setLiquidator(vault.address, user1.address, true)

        await expect(vaultPositionController.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address)).to.be.revertedWith(
            'Vault: empty position'
        )
    })

    it('redeemMusd', async () => {
        await timeLock.setContractHandler(user0.address, true)

        await expect(timeLock.connect(user0).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith('TimeLock: forbidden')

        await expect(timeLock.connect(wallet).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith(
            'TimeLock: action not signalled'
        )

        await expect(timeLock.connect(user0).signalRedeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith('TimeLock: forbidden')

        await timeLock.connect(wallet).signalRedeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))

        await expect(timeLock.connect(wallet).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith(
            'TimeLock: action time not yet passed'
        )

        await increaseTime(provider, 5 * 24 * 60 * 60)
        await mineBlock(provider)

        await expect(timeLock.connect(wallet).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith(
            `GovernableUnauthorizedAccount("${timeLock.address}")`
        )

        await musd.transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(musd.address)
        await expect(timeLock.connect(wallet).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))).to.be.revertedWith(
            'Vault: _token not whitelisted'
        )

        await timeLock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
        await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
        await mineBlock(provider)
        await timeLock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

        await increaseBlockTime(provider, 10)
        await fulfillController.requestUpdatePrices()
        await miOracle.fulfillRequest([{ tokenIndex: tokenIndexes.BNB, price: toMiOraclePrice(500), lastUpdate: 0 }], 0)

        await timeLock.connect(wallet).signalVaultSetTokenConfig(
            vault.address,
            bnb.address, // _token
            18, // _tokenDecimals
            7000, // _tokenWeight
            300, // _minProfitBps
            expandDecimals(5000, 18), // _maxMusdAmount
            false, // _isStable
            true // isShortable
        )

        await increaseTime(provider, 5 * 24 * 60 * 60)
        await mineBlock(provider)

        await timeLock.connect(wallet).vaultSetTokenConfig(
            vault.address,
            bnb.address, // _token
            18, // _tokenDecimals
            7000, // _tokenWeight
            300, // _minProfitBps
            expandDecimals(5000, 18), // _maxMusdAmount
            false, // _isStable
            true // isShortable
        )

        await bnb.mint(vault.address, expandDecimals(3, 18))

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        await vault.buyMUSD(bnb.address, user3.address)

        await timeLock.signalTransferGovernance(vault.address, user1.address)

        await increaseTime(provider, 5 * 24 * 60 * 60)
        await mineBlock(provider)

        await timeLock.transferGovernance(vault.address, user1.address)
        await vault.connect(user1).acceptGovernance()
        await vault.connect(user1).setInManagerMode(true)
        await vault.connect(user1).transferGovernance(timeLock.address)
        await timeLock.acceptGovernance(vault.address)
        expect(await bnb.balanceOf(mintReceiver.address)).eq(0)

        await miOracle.refreshLastPrice([tokenIndexes.BTC, tokenIndexes.USDT, tokenIndexes.BNB], 10, 3)

        await timeLock.connect(wallet).redeemMusd(vault.address, bnb.address, expandDecimals(1000, 18))
        expect(await bnb.balanceOf(mintReceiver.address)).eq('1994000000000000000') // 1.994
    })
})
