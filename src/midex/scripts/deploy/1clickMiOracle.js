const { deployContract, contractAt, sendTxn, expandDecimals, toUsd, getContractAddress } = require('../shared/helpers')
const { errors } = require('../shared/errorCodes')
const { ethers } = require('hardhat')

async function main() {
    const [deployer, relayQuickNode, relayFulfillNode, proxyAdmin, liquidator] = await ethers.getSigners()
    let tokenList = [],
        miOracle,
        faucetList = []
    const depositWETH = '0.001' // use for network fee
    const depositFee = '30' // 0.3%
    const minExecutionFee = '300000000000000' // 0.0003 ETH
    const minRewardCompound = '10000000000000000' // 0.01 = $15 ETH $1500
    const fulfillFee = 3000 // 30%
    const minFeeBalance = 0.02 * 10 ** 9
    const tokenIndexes = {
        BTC: 0,
        ETH: 1,
        BNB: 2,
        USDT: 3,
        BUSD: 4,
        USDC: 5,
        DAI: 6,
        XRP: 7,
        DOGE: 8,
        TRX: 9,
        ADA: 10,
        MATIC: 11,
        SOL: 12,
        DOT: 13,
        LINK: 14,
        FTM: 15,
        NEAR: 16,
        ATOM: 17,
        OP: 18,
        ARB: 19,
    }
    const symbols = {
        [tokenIndexes.BTC]: 'BTC',
        [tokenIndexes.ETH]: 'ETH',
        [tokenIndexes.BNB]: 'BNB',
        [tokenIndexes.USDT]: 'USDT',
        [tokenIndexes.BUSD]: 'BUSD',
        [tokenIndexes.USDC]: 'USDC',
        [tokenIndexes.DAI]: 'DAI',
        [tokenIndexes.XRP]: 'XRP',
        [tokenIndexes.DOGE]: 'DOGE',
        [tokenIndexes.TRX]: 'TRX',
        [tokenIndexes.ADA]: 'ADA',
        [tokenIndexes.MATIC]: 'MATIC',
        [tokenIndexes.SOL]: 'SOL',
        [tokenIndexes.DOT]: 'DOT',
        [tokenIndexes.LINK]: 'LINK',
        [tokenIndexes.FTM]: 'FTM',
        [tokenIndexes.NEAR]: 'NEAR',
        [tokenIndexes.ATOM]: 'ATOM',
        [tokenIndexes.OP]: 'OP',
        [tokenIndexes.ARB]: 'ARB',
    }
    const priceFeedSigners = [
        { publicAddress: '0xaFBCF42F633a02A5009c6c026A4699D673E51b0f', privateKey: '0xe4b848165442612870323559f4965c8acddaf7037cc9688108d2ec351560c145' },
        { publicAddress: '0x9095568cE340ebFAD62A03B17FDfDCDbdf55808d', privateKey: '0xb48a060bd5a86b1641607dc42b679fd0037ede4ec6afc82bbc2e541e62208b6d' },
        { publicAddress: '0x2e2d86cA4155d49E503f48C0Cef7423C0230B55b', privateKey: '0x981440bd742c0af527c0b7bf8e2644dced127fa5f87923333671671aebe8ae41' },
        { publicAddress: '0x15cD0016B48c31cF6579a73ad969dFB89424D236', privateKey: '0x3097f10378091f801fa0d1be9b5a87b67ea53e2d924613866bac707df61d1a9b' },
        { publicAddress: '0x403b0399B77c2Bda2972a237242B61f261014e1d', privateKey: '0xf821b20abd85361ec98fa19217200a6f51394983b6e72065b482fd504d44fcb5' },
        { publicAddress: '0x5B2b18296b24a62B499eaA72079db4Bc3F93cC68', privateKey: '0x454c43457d86a0a7f440ca3f0d3e731cf9d227feee57c173c224934339bb629c' },
        { publicAddress: '0xa6c37E918b7BC6BD83E732D2F8411213f98f4a9A', privateKey: '0x24339c9d6b7da92003d4c92db702cb3c110c24fb5406d613d29e53ea96fdb1b2' },
        { publicAddress: '0x000912b43D511228Ff22956B4C6EB958a0125E69', privateKey: '0x77baeb9d731d7fc6ce01e68a64fd8ff7e8c344173f930cb4a472e46c3ad9bb85' },
        { publicAddress: '0x5D62257394c5aac2dEdf30192B91d01B395c119c', privateKey: '0x84ca1d31899adaed422b26a0d96ee4dfd3727c7ba99ac2c5f81a3b7915f64e94' },
        { publicAddress: '0x98e58c0D821152E90F702973B26C67736fc65041', privateKey: '0xbc907b94feb0e7dcbadb82f22539692c73159bddefaeec780f15e7dd6ebba2ee' },
    ]
    // deploy Native Token
    const nativeToken = await deployContract('WETH', ['Wrapped Ether', 'WETH'], 'nativeToken', deployer)
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
    const btc = await deployContract('FaucetToken', ['Bitcoin', 'BTC', 18, expandDecimals(1000, 18)], 'btcFaucet', deployer)
    const bnb = await deployContract('FaucetToken', ['Binance Coin', 'BNB', 18, expandDecimals(1000, 18)], 'bnbFaucet', deployer)
    const usdt = await deployContract('FaucetToken', ['Tether Coin', 'USDT', 18, expandDecimals(1000, 18)], 'usdtFaucet', deployer)
    const usdc = await deployContract('FaucetToken', ['USDC Coin', 'USDC', 18, expandDecimals(1000, 18)], 'usdcFaucet', deployer)
    const matic = await deployContract('FaucetToken', ['Matic Polygon', 'MATIC', 18, expandDecimals(1000, 18)], 'maticFaucet', deployer)
    const op = await deployContract('FaucetToken', ['Optimism Network', 'OP', 18, expandDecimals(1000, 18)], 'opFaucet', deployer)
    const link = await deployContract('FaucetToken', ['ChainLink Token', 'LINK', 18, expandDecimals(1000, 18)], 'linkFaucet', deployer)

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
    const tokenArr = {
        btc: {
            name: 'btcFaucet',
            address: btc.address,
            priceFeed: tokenList[0],
            decimals: 18,
            tokenIndex: 0,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 15000, // 15%
            minProfitBps: 0,
            maxMusdAmount: 150 * 1000 * 1000,
            // bufferAmount: 450,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
        eth: {
            name: 'weth',
            address: nativeToken.address,
            priceFeed: tokenList[1],
            decimals: 18,
            tokenIndex: 1,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 10000, // 10%
            minProfitBps: 0,
            maxMusdAmount: 100 * 1000 * 1000,
            // bufferAmount: 15000,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
        bnb: {
            name: 'bnbFaucet',
            address: bnb.address,
            priceFeed: tokenList[2],
            decimals: 18,
            tokenIndex: 2,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 10000, // 10%
            minProfitBps: 0,
            maxMusdAmount: 100 * 1000 * 1000,
            // bufferAmount: 15000,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
        usdt: {
            name: 'usdtFaucet',
            address: usdt.address,
            priceFeed: tokenList[3],
            decimals: 18,
            tokenIndex: 3,
            priceDecimals: 8,
            isStrictStable: true,
            tokenWeight: 35000, // 35%
            minProfitBps: 0,
            maxMusdAmount: 350 * 1000 * 1000,
            // bufferAmount: 60 * 1000 * 1000,
            isStable: true,
            isShortable: false,
        },
        usdc: {
            name: 'usdcFaucet',
            address: usdc.address,
            decimals: 18,
            priceFeed: tokenList[4],
            priceDecimals: 8,
            isStrictStable: true,
            tokenWeight: 15000, // 15%
            minProfitBps: 0,
            maxMusdAmount: 150 * 1000 * 1000,
            // bufferAmount: 60 * 1000 * 1000,
            isStable: true,
            isShortable: false,
        },
        matic: {
            name: 'maticFaucet',
            address: matic.address,
            priceFeed: tokenList[5],
            decimals: 18,
            tokenIndex: 1,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 5000, // 5%
            minProfitBps: 0,
            maxMusdAmount: 50 * 1000 * 1000,
            // bufferAmount: 15000,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
        op: {
            name: 'opFaucet',
            address: op.address,
            priceFeed: tokenList[6],
            decimals: 18,
            tokenIndex: 1,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 5000, // 5%
            minProfitBps: 0,
            maxMusdAmount: 50 * 1000 * 1000,
            // bufferAmount: 15000,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
        link: {
            name: 'linkFaucet',
            address: link.address,
            priceFeed: tokenList[7],
            decimals: 18,
            tokenIndex: 1,
            priceDecimals: 8,
            fastPricePrecision: 1000,
            isStrictStable: false,
            tokenWeight: 5000, // 5%
            minProfitBps: 0,
            maxMusdAmount: 50 * 1000 * 1000,
            // bufferAmount: 15000,
            isStable: false,
            isShortable: true,
            maxGlobalShortSize: 30 * 1000 * 1000,
        },
    }
    for (const token of Object.keys(tokenArr)) {
        console.log('setTokenConfig:', tokenArr[token].name)
        await sendTxn(
            vaultPriceFeed.setTokenConfig(
                tokenArr[token].address, // _token
                tokenArr[token].priceFeed, // _priceFeed
                tokenArr[token].priceDecimals, // _priceDecimals
                tokenArr[token].isStrictStable // _isStrictStable
            ),
            `vaultPriceFeed.setTokenConfig(${tokenArr[token].name}) ${tokenArr[token].address} ${tokenArr[token].priceFeed}`
        )
        await sendTxn(
            vault.setTokenConfig(
                tokenArr[token].address, // _token
                tokenArr[token].decimals, // _tokenDecimals
                tokenArr[token].tokenWeight, // _tokenWeight
                tokenArr[token].minProfitBps, // _minProfitBps
                expandDecimals(tokenArr[token].maxMusdAmount, 18), // _maxMusdAmount
                tokenArr[token].isStable, // _isStable
                tokenArr[token].isShortable // _isShortable
            ),
            `vault.setTokenConfig(${tokenArr[token].name}) ${tokenArr[token].address}`
        )
    }

    // setController for deployer and Call requestUpdatePrices
    await sendTxn(fulfillController.setController(deployer.address, true), `fulfillController.setController(${deployer.address})`)

    // wrap ETH and deposit fund
    await sendTxn(nativeToken.deposit({ value: ethers.utils.parseEther(depositWETH) }), `weth.deposit(${depositWETH})`)
    await sendTxn(nativeToken.transfer(fulfillController.address, ethers.utils.parseEther(depositWETH)), `weth.transfer(${fulfillController.address})`)

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
            { tokenIndex: 0, price: 16587.135 },
            { tokenIndex: 1, price: 1218.95 },
            { tokenIndex: 2, price: 316.8 },
            { tokenIndex: 3, price: 1.0001 },
            { tokenIndex: 5, price: 1.0001 },
            { tokenIndex: 11, price: 0.861 },
            { tokenIndex: 14, price: 1.2341 },
            { tokenIndex: 18, price: 13.861 },
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

    // mint faucet Tokens to external wallet
    await sendTxn(btc.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint BTC')
    await sendTxn(bnb.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint BNB')
    await sendTxn(usdt.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint USDT')
    await sendTxn(usdc.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint USDC')
    await sendTxn(matic.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint MATIC')
    await sendTxn(op.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint OP')
    await sendTxn(link.mint(liquidator.address, expandDecimals(10000000, 18)), 'Mint LINK')
    // mint faucet Tokens to deployer wallet
    await sendTxn(btc.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint BTC')
    await sendTxn(bnb.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint BNB')
    await sendTxn(usdt.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint USDT')
    await sendTxn(usdc.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint USDC')
    await sendTxn(matic.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint MATIC')
    await sendTxn(op.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint OP')
    await sendTxn(link.mint(deployer.address, expandDecimals(10000000, 18)), 'Mint LINK')
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
