const { deployContract, contractAt, sendTxn, expandDecimals, toUsd, getContractAddress } = require('../shared/helpers')
const { errors } = require('../shared/errorCodes')
const { ethers } = require('hardhat')
const { tokenArray } = require('../shared/baseGoerli.tokens')
const { configAddress, tokenIndexes, symbols, priceFeedSigners } = require('../shared/baseGoerli.config')

async function main() {
    const [deployer, relayQuickNode, relayFulfillNode, proxyAdmin, liquidator] = await ethers.getSigners()
    let tokenList = [],
        miOracle,
        faucetList = []
    const depositWETH = '1' // use for network fee
    const depositFee = '30' // 0.3%
    const minExecutionFee = '300000000000000' // 0.0003 ETH
    const minRewardCompound = '10000000000000000' // 0.01 = $15 ETH $1500
    const fulfillFee = 3000 // 30%
    const minFeeBalance = 0.02 * 10 ** 9
    // deploy Native Token
    const phrase = 'nephew axis bullet strong worth silly dizzy album truth index climb type'
    const root = '0xd4488dfbcdbfef2f2552fc3d9fe02ace4fa85a29c7eadd086cdb53cd29631683'
    const nativeToken = await deployContract('WrappedETH', [root], 'nativeToken', deployer)
    // deploy logic
    const miOracle_logic = await deployContract('MiOracle', [], 'miOracle_logic', deployer)
    // deploy proxy
    const miOracle_proxy = await deployContract('AdminUpgradeabilityProxy', [miOracle_logic.address, proxyAdmin.address, '0x'], 'miOracle', deployer)
    // initialize
    miOracle = await contractAt('MiOracle', miOracle_proxy.address, deployer)
    await miOracle.initialize(nativeToken.address)
    // deploy PriceFeedStore
    let keys = Object.keys(tokenIndexes)
    let values = Object.values(tokenIndexes)
    for (let i = 0; i < Object.keys(tokenIndexes).length; i++) {
        let key = keys[i]
        const contract = await deployContract(
            'PriceFeedStore',
            [miOracle.address, `${key}/USD Price Feed`, values[i], 8],
            `${key.toLowerCase()}PriceFeed`,
            deployer
        )
        tokenList.push(contract.address)
    }
    // saveTo MiOracle contract
    await sendTxn(miOracle.setPriceFeedStore(tokenList), `miOracle.setPriceFeedStore(${tokenList})`)
    // set signer
    for (let i = 0; i < priceFeedSigners.length; i++) {
        await sendTxn(miOracle.setSigner(priceFeedSigners[i].publicAddress, true), `miOracle.setSigner(${priceFeedSigners[i]})isTrue`)
    }
    await sendTxn(miOracle.setThreshold(priceFeedSigners.length), `miOracle.setThreshold(${priceFeedSigners.length})`)
    // set controller
    const relayNodes = [relayQuickNode.address, relayFulfillNode.address]
    for (let i = 0; i < relayNodes.length; i++) {
        await sendTxn(miOracle.setController(relayNodes[i], true), `miOracle.setController(${relayNodes[i]})`)
    }
    // set requestFee
    await sendTxn(miOracle.setFulfillFee(fulfillFee), `miOracle.setFulfillFee(${fulfillFee})`)
    await sendTxn(miOracle.setMinFeeBalance(minFeeBalance), `miOracle.setMinFeeBalance(${minFeeBalance})`)

    // deploy Faucet Tokens
    for (let i = 0; i < Object.keys(tokenIndexes).length; i++) {
        let key = keys[i]
        const contract = await deployContract('FaucetToken', [`${key} Faucet Token`, key, 18, expandDecimals(1000, 18)], `${key.toLowerCase()}Faucet`, deployer)
        // mint faucet Tokens to external wallet
        await sendTxn(contract.mint(liquidator.address, expandDecimals(10000000, 18)), `Mint ${key} Faucet Token`)
        // mint faucet Tokens to deployer wallet
        await sendTxn(contract.mint(deployer.address, expandDecimals(10000000, 18)), `Mint ${key} Faucet Token`)
        faucetList.push(contract.address)
    }

    // deploy Vault
    const vault = await deployContract('Vault', [], '', deployer)
    const vaultPositionController = await deployContract('VaultPositionController', [], '', deployer)
    const musd = await deployContract('MUSD', [vault.address], '', deployer)
    const router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, nativeToken.address], '', deployer)
    const vaultPriceFeed = await deployContract('VaultPriceFeed', [], '', deployer)
    const milp = await deployContract('MILP', [], '', deployer)
    const milpManager = await deployContract('MilpManager', [vault.address, musd.address, milp.address, 15 * 60], '', deployer)
    const vaultErrorController = await deployContract('VaultErrorController', [], '', deployer)

    // initialize contracts
    await sendTxn(vaultPositionController.initialize(vault.address), 'vaultPositionController.initialize')
    await sendTxn(vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(5, 28)), 'vaultPriceFeed.setMaxStrictPriceDeviation') // 0.05 USD
    await sendTxn(vaultPriceFeed.setPriceSampleSpaceTime(10 * 3), 'vaultPriceFeed.setPriceSampleSpace')
    await sendTxn(milp.setInPrivateTransferMode(true), 'milp.setInPrivateTransferMode')
    await sendTxn(milpManager.setInPrivateMode(true), 'milpManager.setInPrivateMode')
    await sendTxn(milp.setMinter(milpManager.address, true), 'milp.setMinter')
    await sendTxn(musd.addVault(milpManager.address), 'musd.addVault(milpManager)')
    await sendTxn(
        vault.initialize(
            vaultPositionController.address, // vaultPositionController
            router.address, // router
            musd.address, // musd
            vaultPriceFeed.address, // priceFeed
            toUsd(2), // liquidationFeeUsd
            100, // fundingRateFactor
            100 // stableFundingRateFactor
        ),
        'vault.initialize'
    )
    await sendTxn(vault.setFundingRate(60 * 60, 100, 100), 'vault.setFundingRate')
    await sendTxn(vault.setMaxLeverage(50.1 * 10000), 'vault.setMaxLeverage')
    await sendTxn(vault.setInManagerMode(true), 'vault.setInManagerMode')
    await sendTxn(vault.setManager(milpManager.address, true), 'vault.setManager')
    await sendTxn(vault.setManager(liquidator.address, true), 'vault.setManager(liquidator)')
    await sendTxn(
        vault.setFees(
            10, // _taxBasisPoints
            5, // _stableTaxBasisPoints
            20, // _mintBurnFeeBasisPoints
            20, // _swapFeeBasisPoints
            1, // _stableSwapFeeBasisPoints
            10, // _marginFeeBasisPoints
            toUsd(2), // _liquidationFeeUsd
            24 * 60 * 60, // _minProfitTime
            true // _hasDynamicFees
        ),
        'vault.setFees'
    )
    await sendTxn(vault.setErrorController(vaultErrorController.address), 'vault.setErrorController')
    await sendTxn(vaultErrorController.setErrors(vault.address, errors), 'vaultErrorController.setErrors')

    // deploy ReferralStorage
    const referralStorage = await deployContract('ReferralStorage', [], '', deployer)

    // deploy PositionRouter
    const positionRouter = await deployContract(
        'PositionRouter',
        [vault.address, vaultPositionController.address, router.address, nativeToken.address, depositFee, minExecutionFee],
        'PositionRouter',
        deployer
    )

    // initialize PositionRouter
    await sendTxn(positionRouter.setReferralStorage(referralStorage.address), 'positionRouter.setReferralStorage')
    await sendTxn(referralStorage.setHandler(positionRouter.address, true), 'referralStorage.setHandler(positionRouter)')
    await sendTxn(router.addPlugin(positionRouter.address), 'router.addPlugin')
    await sendTxn(positionRouter.setDelayValues(1, 180, 30 * 60), 'positionRouter.setDelayValues')
    await sendTxn(positionRouter.setPositionKeeper(liquidator.address, true), 'positionRouter.setPositionKeeper')

    // deploy OrderBook
    const orderBook = await deployContract('OrderBook', [], 'OrderBook', deployer)
    // deploy OrderBookOpenOrder
    const orderBookOpenOrder = await deployContract('OrderBookOpenOrder', [orderBook.address, vaultPositionController.address], 'OrderBookOpenOrder', deployer)
    // deploy PositionManager
    const positionManager = await deployContract(
        'PositionManager',
        [vault.address, vaultPositionController.address, router.address, nativeToken.address, depositFee, orderBook.address],
        '',
        deployer
    )

    // initialize OrderBook
    await sendTxn(
        orderBook.initialize(
            router.address,
            vault.address,
            vaultPositionController.address,
            orderBookOpenOrder.address,
            nativeToken.address, // weth
            musd.address, // musd
            '300000000000000', // 0.0003 ETH
            expandDecimals(10, 30) // min purchase token amount usd $10
        ),
        'orderBook.initialize'
    )
    await sendTxn(orderBook.setOrderExecutor(positionManager.address), 'orderBook.setOrderExecutor(positionManager)')

    // initialize Position Manager
    await sendTxn(positionManager.setOrderKeeper(liquidator.address, true), 'positionManager.setOrderKeeper(liquidator)')
    await sendTxn(positionManager.setLiquidator(liquidator.address, true), 'positionManager.setLiquidator(liquidator)')
    await sendTxn(positionManager.setIncreasePositionBufferBps(100), 'positionManager.setIncreasePositionBufferBps(100)')
    await sendTxn(positionManager.setShouldValidateIncreaseOrder(false), 'positionManager.setShouldValidateIncreaseOrder(false)')

    // add Plugin to Router
    await sendTxn(router.addPlugin(positionManager.address), 'router.addPlugin(positionManager)')
    await sendTxn(router.addPlugin(orderBook.address), 'router.addPlugin(orderBook)')

    // deploy Reward Router
    const feeMilpTracker = await deployContract('RewardTracker', ['Fee MILP', 'fMILP'], 'feeMilpTracker', deployer)
    const feeMilpDistributor = await deployContract('RewardDistributor', [nativeToken.address, feeMilpTracker.address], 'feeMilpDistributor', deployer)
    const rewardRouter = await deployContract('RewardRouter', [], 'RewardRouter', deployer)

    // initialize Reward Router
    await sendTxn(feeMilpTracker.initialize([milp.address], feeMilpDistributor.address), 'feeMilpTracker.initialize')
    await sendTxn(feeMilpDistributor.updateLastDistributionTime(), 'feeMilpDistributor.updateLastDistributionTime')
    await sendTxn(feeMilpTracker.setInPrivateTransferMode(true), 'feeMilpTracker.setInPrivateTransferMode')
    await sendTxn(feeMilpTracker.setInPrivateStakingMode(true), 'feeMilpTracker.setInPrivateStakingMode')
    await sendTxn(
        rewardRouter.initialize(nativeToken.address, milp.address, feeMilpTracker.address, milpManager.address, minRewardCompound),
        'rewardRouter.initialize'
    )
    await sendTxn(milpManager.setHandler(rewardRouter.address, true), 'milpManager.setHandler(rewardRouter)')
    // allow feeMilpTracker to stake milp
    await sendTxn(milp.setHandler(feeMilpTracker.address, true), 'milp.setHandler(feeMilpTracker)')
    // allow rewardRouter to stake in feeMilpTracker
    await sendTxn(feeMilpTracker.setHandler(rewardRouter.address, true), 'feeMilpTracker.setHandler(rewardRouter)')

    // deploy FulfillController
    const fulfillController = await deployContract('FulfillController', [miOracle.address, nativeToken.address, 0], '', deployer)

    // setFulfillController
    await sendTxn(milpManager.setFulfillController(fulfillController.address), `milpManager.setFulfillController`)
    await sendTxn(rewardRouter.setFulfillController(fulfillController.address), `rewardRouter.setFulfillController`)
    await sendTxn(router.setFulfillController(fulfillController.address), `router.setFulfillController`)
    await sendTxn(positionManager.setFulfillController(fulfillController.address), `positionManager.setFulfillController`)
    await sendTxn(positionRouter.setFulfillController(fulfillController.address, liquidator.address), `positionRouter.setFulfillController`)
    await sendTxn(orderBook.setFulfillController(fulfillController.address), `orderBook.setFulfillController`)

    // setHandler
    await sendTxn(fulfillController.setHandler(milpManager.address, true), `fulfillController.setHandler(${milpManager.address})`)
    await sendTxn(fulfillController.setHandler(rewardRouter.address, true), `fulfillController.setHandler(${rewardRouter.address})`)
    await sendTxn(fulfillController.setHandler(router.address, true), `fulfillController.setHandler(${router.address})`)
    await sendTxn(fulfillController.setHandler(positionManager.address, true), `fulfillController.setHandler(${positionManager.address})`)
    await sendTxn(fulfillController.setHandler(positionRouter.address, true), `fulfillController.setHandler(${positionRouter.address})`)
    await sendTxn(fulfillController.setHandler(orderBook.address, true), `fulfillController.setHandler(${orderBook.address})`)

    // set config Position Manager
    await sendTxn(positionManager.setMaxExecuteOrder(1), `positionManager.setMaxExecuteOrder(1)`)
    await sendTxn(positionManager.setOrderKeeper(liquidator.address, true), `positionManager.setOrderKeeper(liquidator)`)
    await sendTxn(positionManager.setLiquidator(liquidator.address, true), `positionManager.setLiquidator(liquidator)`)

    // whitelist tokens
    for (const token of Object.keys(tokenArray)) {
        const tokenName = tokenArray[token].name
        if (tokenName) {
            console.log('setTokenConfig:', tokenName)
            await sendTxn(
                vaultPriceFeed.setTokenConfig(
                    tokenArray[token].address, // _token
                    tokenArray[token].priceFeed, // _priceFeed
                    tokenArray[token].priceDecimals, // _priceDecimals
                    tokenArray[token].isStrictStable // _isStrictStable
                ),
                `vaultPriceFeed.setTokenConfig(${tokenArray[token].name}) ${tokenArray[token].address} ${tokenArray[token].priceFeed}`
            )
            await sendTxn(
                vault.setTokenConfig(
                    tokenArray[token].address, // _token
                    tokenArray[token].decimals, // _tokenDecimals
                    tokenArray[token].tokenWeight, // _tokenWeight
                    tokenArray[token].minProfitBps, // _minProfitBps
                    expandDecimals(tokenArray[token].maxMusdAmount, 18), // _maxMusdAmount
                    tokenArray[token].isStable, // _isStable
                    tokenArray[token].isShortable // _isShortable
                ),
                `vault.setTokenConfig(${tokenArray[token].name}) ${tokenArray[token].address}`
            )
        } else console.log(`Invalid Token or PriceFeed ${token}`)
    }

    // setController for deployer and Call requestUpdatePrices
    await sendTxn(fulfillController.setController(deployer.address, true), `fulfillController.setController(${deployer.address})`)

    // wrap ETH and deposit fund
    await sendTxn(nativeToken.deposit({ value: ethers.utils.parseEther('100') }), `weth.deposit(100ETH)`)
    await sendTxn(nativeToken.transfer(fulfillController.address, ethers.utils.parseEther(depositWETH)), `weth.transfer(${fulfillController.address})`)
    await sendTxn(nativeToken.transfer(relayQuickNode.address, ethers.utils.parseEther(depositWETH)), `weth.transfer(${relayQuickNode.address})`)

    // fulfillRequest
    {
        // requestUpdatePrices
        let tx = await sendTxn(fulfillController.requestUpdatePrices(), `fulfillController.requestUpdatePrices()`)

        // updatePrice
        console.log('Receive a fulfillRequestPrice')
        let reqID = await miOracle.reqId() // last reqId (assume only one used)
        const requestResult = await miOracle.getRequest(reqID)
        let request = {
            timestamp: requestResult[0],
            owner: requestResult[1],
            payload: requestResult[2],
            status: requestResult[3],
            expiration: requestResult[4],
        }
        const block1 = await ethers.provider.getBlock(tx.blockNumber)
        console.log(`Current block number: ${block1.timestamp}`)

        // initial first price and respond for request
        const prices = [
            { tokenIndex: 0, price: 37587.135 },
            { tokenIndex: 1, price: 2042.95 },
            { tokenIndex: 2, price: 247.8 },
            { tokenIndex: 3, price: 1.0001 },
            { tokenIndex: 4, price: 0.9998 },
            { tokenIndex: 5, price: 1.0001 },
            { tokenIndex: 6, price: 1.0001 },
            { tokenIndex: 10, price: 0.6216 },
            { tokenIndex: 11, price: 0.8061 },
            { tokenIndex: 12, price: 1.0401 },
            { tokenIndex: 20, price: 3.8484 },
            { tokenIndex: 21, price: 0.8113 },
            { tokenIndex: 22, price: 5.9865 },
            { tokenIndex: 23, price: 5.4857 },
            { tokenIndex: 24, price: 22.0309 },
            { tokenIndex: 25, price: 0.3333 },
            { tokenIndex: 26, price: 2.1145 },
            { tokenIndex: 27, price: 0.9392 },
            { tokenIndex: 28, price: 1.7967 },
            { tokenIndex: 29, price: 1.0657 },
        ]
        const data = await Promise.all(
            priceFeedSigners.map(async (priceFeedSigner) => {
                const priceHex = pricesToHexString(prices) // fetchPriceToHex(`https://api.xoracle.io/prices/xoracle`) //
                const messageHash = ethers.utils.solidityKeccak256(['uint256', 'bytes'], [request.timestamp.toString(), priceHex])
                const wallet = new ethers.Wallet(priceFeedSigner.privateKey)
                const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash)) // 65 bytes
                return {
                    timestamp: request.timestamp.toString(),
                    signer: priceFeedSigner.publicAddress,
                    signature: signature,
                    prices: priceHex,
                }
            })
        )
        console.log(data)
        tx = await miOracle.connect(relayQuickNode).fulfillRequest(data, reqID)
        const receipt = await tx.wait()
        const gasSpent = receipt.gasUsed * receipt.effectiveGasPrice
        const fulfillRespond = {
            tx: tx.hash,
            receipt: receipt.result,
            gasSpent: gasSpent,
            gasUsed: receipt.gasUsed,
            gasPrice: receipt.effectiveGasPrice,
        }
        // getting timestamp
        const block2 = await ethers.provider.getBlock(tx.blockNumber)
        console.log(`FulFilled block number: ${block2.timestamp}`)
    }
}

async function fetchPriceToHex(url) {
    // url = `https://api.xoracle.io/prices/xoracle`
    const fetchPrices = await JSON.parse(await fetch(url).then((res) => res.text()))
    let keys = Object.keys(fetchPrices)
    let values = Object.values(fetchPrices)
    var result = ''
    for (i = 0; i < fetchPrices.length; i++) {
        result += keys[i].toString(16).padStart(4, '0')
        result += values[i].toString(16).padStart(12, '0')
    }
    return '0x' + result
}

function pricesToHexString(prices) {
    var result = ''
    for (i = 0; i < prices.length; i++) {
        result += prices[i].tokenIndex.toString(16).padStart(4, '0')
        result += adjustPrice(prices[i].price).toString(16).padStart(12, '0')
    }
    return '0x' + result
}

function adjustPrice(price) {
    return Math.floor(price * 10 ** 8)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
