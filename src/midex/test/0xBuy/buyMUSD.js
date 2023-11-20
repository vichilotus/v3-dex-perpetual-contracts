const { expect } = require('chai')
const helpers = require('@nomicfoundation/hardhat-network-helpers')
const crypto = require('crypto')
const { toUsd } = require('../shared/units')
const { expandDecimals } = require('../shared/utilities')
const { deployContract } = require('../shared/fixtures')
const { errors } = require('../../scripts/shared/errorCodes')
const { getBnbConfig, getBtcConfig, getDaiConfig } = require('../core/Vault/helpers')

const tokenIndexes = {
    BTC: 0,
    ETH: 1,
    BNB: 2,
    USDT: 3,
    BUSD: 4,
    USDC: 5,
}
const symbol = {
    [tokenIndexes.BTC]: 'BTC',
    [tokenIndexes.ETH]: 'ETH',
    [tokenIndexes.BNB]: 'BNB',
    [tokenIndexes.USDT]: 'USDT',
    [tokenIndexes.BUSD]: 'BUSD',
    [tokenIndexes.USDC]: 'USDC',
}

let priceList = []
let signers = []
let weth
let vault
let vaultUtils
let vaultPriceFeed
let positionManager
let musd
let router
let testSwap
let miOracle
let PriceFeedStore
let btcPriceFeed
let ethPriceFeed
let bnbPriceFeed
let usdtPriceFeed
let usdcPriceFeed
let busdPriceFeed
let fulfillController
let btc
let busd
let bnb
const fulfillFee = 3000 // 30%
const minFeeBalance = 0.02 * 10 ** 9

describe('\n📌 ### Test Buy-Sell MUSD ###\n', function () {
    before('Initial data', async function () {
        console.log('👻 make signers')
        makeSigner(8)

        console.log('👻 make price list')
        makePriceList()
    })

    beforeEach('Deploy MiOracle Contract', async function () {
        const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()

        // deploy wrapped ether
        const WETH = await ethers.getContractFactory('WETH')
        weth = await WETH.deploy('Wrapped Ether', 'WETH')

        // deploy logic
        const MiOracle = await ethers.getContractFactory('MiOracle')
        const miOracle_logic = await MiOracle.deploy()

        // deploy proxy
        const AdminUpgradeabilityProxy = await ethers.getContractFactory('AdminUpgradeabilityProxy')
        const miOracle_proxy = await AdminUpgradeabilityProxy.deploy(miOracle_logic.address, proxyAdmin.address, '0x')

        // initialize
        miOracle = await MiOracle.attach(miOracle_proxy.address)
        await miOracle.initialize(weth.address)

        // deploy PriceFeedStore
        PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')
        btcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BTC/USD Price Feed', tokenIndexes.BTC, 8)
        ethPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'ETH/USD Price Feed', tokenIndexes.ETH, 8)
        bnbPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BNB/USD Price Feed', tokenIndexes.BNB, 8)
        usdtPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDT/USD Price Feed', tokenIndexes.USDT, 8)
        busdPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BUSD/USD Price Feed', tokenIndexes.BUSD, 8)
        usdcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDC/USD Price Feed', tokenIndexes.USDC, 8)

        // setPriceFeedStore
        const priceFeedList = [
            btcPriceFeed.address,
            ethPriceFeed.address,
            bnbPriceFeed.address,
            usdtPriceFeed.address,
            busdPriceFeed.address,
            usdcPriceFeed.address,
        ]
        await miOracle.setPriceFeedStore(priceFeedList)

        //set Signers
        await miOracle.setController(relayNode.address, true)
        for (i = 0; i < signers.length; i++) {
            await miOracle.setSigner(signers[i].publicAddress, true)
            console.log(`Set MiOracle Signer ${i}: ${signers[i].publicAddress}`)
        }

        // set reqFee
        await miOracle.setFulfillFee(fulfillFee)
        await miOracle.setMinFeeBalance(minFeeBalance)

        // get pricePrecision
        const decimals = await miOracle.getDecimals(tokenIndexes.BTC)
        pricePrecision = 10 ** parseInt(decimals)
    })

    beforeEach('Deploy FulfillController Contract', async function () {
        const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()
        btc = await deployContract('Token', [])
        busd = await deployContract('Token', [])
        bnb = await deployContract('Token', [])

        vault = await deployContract('Vault', [])
        vaultPositionController = await deployContract('VaultPositionController', [])
        await vault.setIsLeverageEnabled(false)
        musd = await deployContract('MUSD', [vault.address])
        router = await deployContract('Router', [vault.address, vaultPositionController.address, musd.address, weth.address])
        vaultPriceFeed = await deployContract('VaultPriceFeed', [])

        await vault.initialize(
            vaultPositionController.address, // vaultPositionController
            router.address, // router
            musd.address, // musd
            vaultPriceFeed.address, // priceFeed
            toUsd(5), // liquidationFeeUsd
            600, // fundingRateFactor
            600 // stableFundingRateFactor
        )
        await vaultPositionController.initialize(vault.address)
        const vaultErrorController = await deployContract('VaultErrorController', [])
        await vault.setErrorController(vaultErrorController.address)
        await vaultErrorController.setErrors(vault.address, errors)

        // deploy fulfillController
        fulfillController = await deployContract('FulfillController', [miOracle.address, weth.address, 0])
        testSwap = await deployContract('TestSwapMock', [fulfillController.address, miOracle.address])

        // deposit req fund to fulfillController
        await weth.deposit({ value: ethers.utils.parseEther('11.0') })
        await weth.transfer(fulfillController.address, ethers.utils.parseEther('10.0'))

        // setTokenConfig
        await vault.setTokenConfig(...getDaiConfig(busd))
        await vault.setTokenConfig(...getBtcConfig(btc))
        await vault.setTokenConfig(...getBnbConfig(bnb))

        // set vaultPriceFeed
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(busd.address, usdtPriceFeed.address, 8, false)

        orderBook = await deployContract('OrderBook', [])
        orderBookOpenOrder = await deployContract('OrderBookOpenOrder', [orderBook.address, vaultPositionController.address])

        const minExecutionFee = 500000
        await orderBook.initialize(
            router.address,
            vault.address,
            vaultPositionController.address,
            orderBookOpenOrder.address,
            weth.address,
            musd.address,
            minExecutionFee,
            expandDecimals(5, 30) // minPurchaseTokenAmountUsd
        )
        await router.addPlugin(orderBook.address)
        await router.connect(proxyAdmin).approvePlugin(orderBook.address)

        positionManager = await deployContract('PositionManager', [
            vault.address,
            vaultPositionController.address,
            router.address,
            weth.address,
            50,
            orderBook.address,
        ])

        // setController
        await fulfillController.setController(deployer.address, true)

        // setFulfillController
        await positionManager.setFulfillController(fulfillController.address)
        await router.setFulfillController(fulfillController.address)

        // setHandler
        await fulfillController.setHandler(testSwap.address, true)
        await fulfillController.setHandler(relayNode.address, true)
        await fulfillController.setHandler(router.address, true)
        await fulfillController.setHandler(positionManager.address, true)

        await testSwap.setToken(btc.address, 0, true)
        await testSwap.setToken(busd.address, 4, true)
    })

    it('Test request MiOracle fulfill Request', async function () {
        const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()
        const tx = await fulfillController.requestUpdatePrices()

        // fulfillRequest
        {
            // updatePrice
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
            expect(request.status).eq(0)

            // simulate: next block time 120 sec
            await helpers.time.increase(120)

            // simulate relayNode fulfill request
            const prices = priceList[random(priceList.length)]
            const call = await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)

            // getting timestamp
            const block2 = await ethers.provider.getBlock(call.tx.blockNumber)

            // check price
            for (let tokenIndex of Object.keys(symbol)) {
                const [, /* round */ price, latestPrice, timestamp] = await miOracle.getLastPrice(tokenIndex)
                expect(timestamp).eq(block2.timestamp)

                // check price is latestPrice
                expect(price).to.eq(latestPrice)

                // check priceFeed
                const priceFeed = PriceFeedStore.attach(await miOracle.priceFeedStores(tokenIndex))
                expect(await priceFeed.latestTimestamp()).eq(request.timestamp.toString())
                expect((await priceFeed.getLastPrice())[1]).eq(price)
                expect((await priceFeed.getLastPrice())[2]).eq(latestPrice)
                expect((await priceFeed.getLastPrice())[3]).eq(block2.timestamp)
                console.log(`Latest price of ${symbol[tokenIndex]} is ${price.toString()} at time ${request.timestamp.toString()}`)
            }
        }
    })

    it('buyMUSD', async () => {
        const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()
        await fulfillController.requestUpdatePrices()
        let reqID = await miOracle.reqId() // last reqId (assume only one used)
        const prices = priceList[random(priceList.length)]
        const call = await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)
        await vault.setTokenConfig(...getBtcConfig(btc))
        await btc.mint(proxyAdmin.address, 100)
        await btc.connect(proxyAdmin).transfer(vault.address, 16)
        const tx = await vault.connect(proxyAdmin).buyMUSD(btc.address, relayNode.address, { gasPrice: '10000000000' })
        expect(await musd.balanceOf(relayNode.address)).eq(2491680000000000)
    })
})

function makeSigner(total) {
    const privateKeys = [
        '0xe4b848165442612870323559f4965c8acddaf7037cc9688108d2ec351560c145',
        '0xb48a060bd5a86b1641607dc42b679fd0037ede4ec6afc82bbc2e541e62208b6d',
        '0x981440bd742c0af527c0b7bf8e2644dced127fa5f87923333671671aebe8ae41',
        '0x3097f10378091f801fa0d1be9b5a87b67ea53e2d924613866bac707df61d1a9b',
        '0xf821b20abd85361ec98fa19217200a6f51394983b6e72065b482fd504d44fcb5',
        '0x454c43457d86a0a7f440ca3f0d3e731cf9d227feee57c173c224934339bb629c',
        '0x24339c9d6b7da92003d4c92db702cb3c110c24fb5406d613d29e53ea96fdb1b2',
        '0x77baeb9d731d7fc6ce01e68a64fd8ff7e8c344173f930cb4a472e46c3ad9bb85',
        '0x84ca1d31899adaed422b26a0d96ee4dfd3727c7ba99ac2c5f81a3b7915f64e94',
        '0xbc907b94feb0e7dcbadb82f22539692c73159bddefaeec780f15e7dd6ebba2ee',
    ]
    for (i = 0; i < total; i++) {
        const privateKey = privateKeys[i]
        const wallet = new ethers.Wallet(privateKey)
        console.log(`signer ${i + 1} Address: ${wallet.address}`)
        signers[i] = {
            privateKey: privateKey,
            publicAddress: wallet.address,
        }
    }
}

function makePriceList() {
    priceList[0] = [
        { tokenIndex: 0, price: 16587.135 },
        { tokenIndex: 1, price: 1218.95 },
        { tokenIndex: 2, price: 316.8 },
        { tokenIndex: 3, price: 1.0001 },
        { tokenIndex: 4, price: 1.0001 },
        { tokenIndex: 5, price: 1.0001 },
    ]
    priceList[1] = [
        { tokenIndex: 0, price: 16611.25 },
        { tokenIndex: 1, price: 1222.1 },
        { tokenIndex: 2, price: 315.9 },
        { tokenIndex: 3, price: 1.0005 },
        { tokenIndex: 4, price: 0.999 },
        { tokenIndex: 5, price: 1.0 },
    ]
    priceList[2] = [
        { tokenIndex: 0, price: 16600.02 },
        { tokenIndex: 1, price: 1223.22 },
        { tokenIndex: 2, price: 317.15 },
        { tokenIndex: 3, price: 0.99 },
        { tokenIndex: 4, price: 0.989 },
        { tokenIndex: 5, price: 0.998 },
    ]
}

// simulate relayNode fulfill from request
async function relayNodeFulfill(relayNode, reqID, prices, slippage, checkLastPrice) {
    var accumulatePrices = {}

    // simulate: next block time 10 sec
    await helpers.time.increase(10)

    // simulate: received emit request
    const request = await miOracle.getRequest(reqID)
    const timestamp = request[0].toString()

    const data = await Promise.all(
        signers.map(async (signer) => {
            // make price slippage
            const priceSlippage = randomPriceSlippage(prices, slippage)

            // for expect test
            if (checkLastPrice) {
                priceSlippage.forEach((p) => {
                    accumulatePrices[p.tokenIndex] = (accumulatePrices[p.tokenIndex] || 0) + p.price
                })
            }

            return makePriceFeed(signer, timestamp, priceSlippage)
        })
    )

    const tx = await miOracle.connect(relayNode).fulfillRequest(data, reqID)
    const receipt = await tx.wait()
    const gasSpent = receipt.gasUsed * receipt.effectiveGasPrice

    if (checkLastPrice) {
        // find mean price for expect test
        Object.keys(accumulatePrices).forEach(async (tokenIndex) => {
            const meanPrice = accumulatePrices[tokenIndex] / signers.length
            const lastPrice = await miOracle.getLastPrice(tokenIndex)

            expect(Math.abs(lastPrice[1] - adjustPrice(meanPrice))).lessThan(2)
            expect(lastPrice[3]).eq(timestamp)
        })
    }

    return {
        tx: tx,
        receipt: receipt,
        gasSpent: gasSpent,
        gasUsed: receipt.gasUsed,
        gasPrice: receipt.effectiveGasPrice,
    }
}

function randomPriceSlippage(prices, maxPercent) {
    // maxPercent: 0 - 100
    return prices.map((p) => {
        const random = Math.floor(Math.random() * maxPercent)
        const percent = random / 100
        return {
            tokenIndex: p.tokenIndex,
            price: p.price * (1 + percent),
        }
    })
}

async function makePriceFeed(signer, timestamp, price) {
    const priceHex = pricesToHexString(price)

    // hash
    messageHash = ethers.utils.solidityKeccak256(['uint256', 'bytes'], [timestamp, priceHex])

    // sign
    const wallet = new ethers.Wallet(signer.privateKey)
    const signature = await wallet.signMessage(ethers.utils.arrayify(messageHash)) // 65 bytes

    return {
        timestamp: timestamp,
        signer: signer.publicAddress,
        signature: signature,
        prices: priceHex,
    }
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

function random(max) {
    return Math.floor(Math.random() * max)
}

async function getBlockTimestamp() {
    const blockNumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(blockNumber)
    return parseInt(block.timestamp)
}
