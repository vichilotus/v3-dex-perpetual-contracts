const { expect } = require('chai')
const helpers = require('@nomicfoundation/hardhat-network-helpers')
const crypto = require('crypto')
const { ethers } = require('hardhat')
const { toWei, toETH } = require('../shared/units')

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
let miOracle
let miOracle_logic
let miOracle_proxy
let weth
let testOraclePrice
const fulfillFee = 3000 // 30%
const minFeeBalance = 0.02 * 10 ** 9

describe('\n📌 ### Test miOracle ###\n', function () {
    before('Initial data', async function () {
        console.log('👻 make signers')
        makeSigner(3)

        console.log('👻 make price list')
        makePriceList()
    })

    beforeEach('Deploy MiOracle Contract', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const WETH = await ethers.getContractFactory('WETH')
        weth = await WETH.deploy('Wrapped ETH', 'WETH')

        // deploy logic
        const MiOracle = await ethers.getContractFactory('MiOracle')
        miOracle_logic = await MiOracle.deploy()

        // deploy proxy
        const AdminUpgradeabilityProxy = await ethers.getContractFactory('AdminUpgradeabilityProxy')
        miOracle_proxy = await AdminUpgradeabilityProxy.deploy(miOracle_logic.address, proxyAdmin.address, '0x')

        // initialize
        miOracle = MiOracle.attach(miOracle_proxy.address)
        await miOracle.initialize(weth.address)

        const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')
        const btcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BTC/USD Price Feed', tokenIndexes.BTC, 8)
        const ethPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'ETH/USD Price Feed', tokenIndexes.ETH, 8)
        const bnbPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BNB/USD Price Feed', tokenIndexes.BNB, 8)
        const usdtPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDT/USD Price Feed', tokenIndexes.USDT, 8)
        const busdPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BUSD/USD Price Feed', tokenIndexes.BUSD, 8)
        const usdcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDC/USD Price Feed', tokenIndexes.USDC, 8)

        const priceFeedList = [
            btcPriceFeed.address,
            ethPriceFeed.address,
            bnbPriceFeed.address,
            usdtPriceFeed.address,
            busdPriceFeed.address,
            usdcPriceFeed.address,
        ]
        await miOracle.setPriceFeedStore(priceFeedList)

        await miOracle.setController(relayNode.address, true)

        // add signer
        for (i = 0; i < signers.length; i++) {
            await miOracle.setSigner(signers[i].publicAddress, true)
        }

        // set reqFee
        await miOracle.setFulfillFee(fulfillFee)
        await miOracle.setMinFeeBalance(minFeeBalance)

        // deploy TestOraclePrice Contract
        const TestOraclePrice = await ethers.getContractFactory('TestOraclePrice')
        testOraclePrice = await TestOraclePrice.deploy(miOracle.address, weth.address, Object.keys(symbol))

        // deposit req fee fund
        await weth.deposit({ value: ethers.utils.parseEther('2.0') })
        await weth.transfer(testOraclePrice.address, ethers.utils.parseEther('1.0')) // Sends 1.0 WETH
    })

    it('Test onlyOwner', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()
        const account = [relayNode, user1, user2].at(random(3))

        const revert = 'Ownable: caller is not the owner'
        await expect(miOracle.connect(account).setSigner(account.address, true)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setPause(true)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setController(account.address, true)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setThreshold(1)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setWhitelist(account.address, true)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setOnlyWhitelist(true)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setFulfillFee(0)).to.be.revertedWith(revert)
        await expect(miOracle.connect(account).setMinFeeBalance(0)).to.be.revertedWith(revert)
    })

    it('Test onlyController', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()
        const account = [deployer, user1, user2].at(random(3))

        const revert = 'controller: forbidden'
        await expect(miOracle.connect(account).fulfillRequest([], 0)).to.be.revertedWith(revert)

        // setController false
        await miOracle.setController(relayNode.address, false)
        await expect(miOracle.connect(relayNode).fulfillRequest([], 0)).to.be.revertedWith(revert)
        await expect(miOracle.connect(relayNode).refundRequest(0)).to.be.revertedWith(revert)

        // setController true
        await miOracle.setController(relayNode.address, true)
    })

    it('Test onlyContract', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()
        const account = [deployer, relayNode, user1, user2].at(random(4))

        const revert = 'caller: only contract'
        await expect(miOracle.connect(account).requestPrices(0, 0)).to.be.revertedWith(revert)
    })

    it('Test Signer', async function () {
        // check signer
        for (i = 0; i < signers.length; i++) {
            expect(await miOracle.signers(signers[i].publicAddress)).eq(true)
        }
        expect(await miOracle.totalSigner()).to.eq(signers.length)

        // remove signer
        for (i = 0; i < signers.length; i++) {
            await miOracle.setSigner(signers[i].publicAddress, false)
            expect(await miOracle.signers(signers[i].publicAddress)).eq(false)
        }

        // add signer again
        for (i = 0; i < signers.length; i++) {
            await miOracle.setSigner(signers[i].publicAddress, true)
        }

        // setThreshold
        expect(await miOracle.threshold()).eq(0)
        await miOracle.setThreshold(2)
        expect(await miOracle.threshold()).eq(2)
        await expect(miOracle.setThreshold(4)).to.be.reverted
    })

    it('Test request invalid', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        await expect(miOracle.connect(relayNode).fulfillRequest([], 0)).to.be.revertedWith('request not found')
        await expect(miOracle.connect(relayNode).fulfillRequest([], 999)).to.be.revertedWith('request not found')
    })

    it('Test insufficient request fee', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const TestOraclePrice = await ethers.getContractFactory('TestOraclePrice')
        const testOraclePrice = await TestOraclePrice.deploy(miOracle.address, weth.address, Object.keys(symbol))

        // try call with no fee balance
        const expireTime = 0
        await expect(testOraclePrice.connect(user1).requestUpdatePrices(expireTime)).to.be.revertedWith('insufficient request fee')
    })

    it('Test requestPrices', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()
        const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')

        const beforeFundBalance = await weth.balanceOf(testOraclePrice.address)
        const beforeRelayNodeBalance = await weth.balanceOf(relayNode.address)

        // updatePrice
        const expireTime = 0
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        const request = await getRequest(reqID)

        // status 0 = request
        expect(request.owner).eq(testOraclePrice.address)
        expect(request.status).eq(0)
        expect(request.paymentAvailable).eq(true)

        // simulate: next block time 120 sec
        await helpers.time.increase(120)

        // simulate relayNode fulfill request
        const prices = priceList[random(priceList.length)]
        const call = await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)

        // getting timestamp
        const block = await ethers.provider.getBlock(call.tx.blockNumber)

        // check price
        for (let tokenIndex of Object.keys(symbol)) {
            const [, /* round */ price, latestPrice, timestamp] = await miOracle.getLastPrice(tokenIndex)
            expect(await testOraclePrice.getTokenPrice(tokenIndex)).eq(price)
            expect(timestamp).eq(block.timestamp)

            // check price is latestPrice
            expect(price).to.eq(latestPrice)

            // check priceFeed
            const priceFeed = PriceFeedStore.attach(await miOracle.priceFeedStores(tokenIndex))
            expect(await priceFeed.latestTimestamp()).eq(request.timestamp.toString())
            expect((await priceFeed.getLastPrice())[1]).eq(price)
            expect((await priceFeed.getLastPrice())[2]).eq(latestPrice)
            expect((await priceFeed.getLastPrice())[3]).eq(block.timestamp)
        }

        // check status 1 = fulfilled
        expect((await miOracle.getRequest(reqID))[3]).to.eq(1)

        // check req fee
        const fundBalance = await weth.balanceOf(testOraclePrice.address)
        const relayNodeBalance = await weth.balanceOf(relayNode.address)

        expect(beforeFundBalance.sub(fundBalance)).to.eq(relayNodeBalance.sub(beforeRelayNodeBalance))
    })

    it('Test multiple requestPrices and fulfill not in order', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()
        const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')

        const beforeFundBalance = await weth.balanceOf(testOraclePrice.address)
        const beforeRelayNodeBalance = await weth.balanceOf(relayNode.address)

        var reqIDs = []
        const test_order = [0, 2, 4, 3, 5, 1]
        const count = test_order.length

        // make updatePrices
        for (let i = 0; i < count; i++) {
            const expireTime = 0
            await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

            const reqID = await miOracle.reqId() // last reqId (assume only one used)
            reqIDs.push(reqID)
        }

        // simulate: next block time 120 sec
        await helpers.time.increase(120)

        // simulate relayNode fulfill multiple requests with not in order
        var latestReqID
        var latestPrices = {}
        var latestTimestamps = {}
        for (const order of test_order) {
            const reqID = reqIDs[order]
            const request = await getRequest(reqID)

            // fulfill
            const prices = priceList[random(priceList.length)]
            const call = await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)

            // getting timestamp
            const block = await ethers.provider.getBlock(call.tx.blockNumber)

            // check price
            for (let tokenIndex of Object.keys(symbol)) {
                const [, /* round */ price, latestPrice, timestamp] = await miOracle.getLastPrice(tokenIndex)
                expect(await testOraclePrice.getTokenPrice(tokenIndex)).eq(price)
                expect(timestamp).eq(block.timestamp)

                // check priceFeed
                const priceFeed = PriceFeedStore.attach(await miOracle.priceFeedStores(tokenIndex))
                expect((await priceFeed.getLastPrice())[1]).eq(price)
                expect((await priceFeed.getLastPrice())[2]).eq(latestPrice)
                expect((await priceFeed.getLastPrice())[3]).eq(block.timestamp)

                // update latestPrice, latestTimestamp
                if (!latestReqID || reqID >= latestReqID) {
                    latestReqID = reqID
                    latestPrices[tokenIndex] = latestPrice
                    latestTimestamps[tokenIndex] = request.timestamp
                }

                // check latestPrice, latestTimestamp
                expect(latestPrices[tokenIndex]).to.eq(latestPrice)
                expect(await priceFeed.latestTimestamp()).to.eq(latestTimestamps[tokenIndex])
            }
        }

        // check req fee
        const fundBalance = await weth.balanceOf(testOraclePrice.address)
        const relayNodeBalance = await weth.balanceOf(relayNode.address)

        expect(beforeFundBalance.sub(fundBalance)).to.eq(relayNodeBalance.sub(beforeRelayNodeBalance))
    })

    it('Test cancelRequestPrice', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const beforeFundBalance = await weth.balanceOf(testOraclePrice.address)
        const beforeRelayNodeBalance = await weth.balanceOf(relayNode.address)

        // updatePrice
        const expireTime = 0
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)
        const reqID = await miOracle.reqId() // last reqId (assume only one used)

        // simulate: next block time 3 sec
        await helpers.time.increase(3)

        // cancel
        await testOraclePrice.connect(user1).cancelRequest(reqID)

        // cancel again
        await expect(testOraclePrice.connect(user1).cancelRequest(reqID)).to.be.reverted

        // check status 2 = cancel
        expect((await miOracle.getRequest(reqID))[3]).to.eq(2)

        // simulate relayNode fulfill request
        const prices = priceList[random(priceList.length)]
        await relayNodeFulfill(relayNode, reqID, prices, 1.5, false) // fulfill nothing

        // check status 2 = cancel
        expect((await miOracle.getRequest(reqID))[3]).to.eq(2)

        // check req fee
        const fundBalance = await weth.balanceOf(testOraclePrice.address)
        const relayNodeBalance = await weth.balanceOf(relayNode.address)

        expect(beforeFundBalance).to.eq(fundBalance)
        expect(beforeRelayNodeBalance).to.eq(relayNodeBalance)
    })

    it('Test whenNotPaused', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const expireTime = 0
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)
        const reqID = await miOracle.reqId() // last reqId (assume only one used)

        // set setPause
        await miOracle.setPause(true)

        await expect(testOraclePrice.connect(user1).cancelRequest(reqID)).to.be.revertedWith('Pausable: paused')
        await expect(testOraclePrice.connect(user1).requestUpdatePrices(expireTime)).to.be.revertedWith('Pausable: paused')

        // set setPause
        await miOracle.setPause(false)
    })

    it('Test whitelist', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const expireTime = 0

        // set setOnlyWhitelist
        await miOracle.setOnlyWhitelist(true)

        await expect(testOraclePrice.connect(user1).requestUpdatePrices(expireTime)).to.be.reverted

        // add whitelist
        await miOracle.setWhitelist(testOraclePrice.address, true)

        await expect(testOraclePrice.connect(user1).requestUpdatePrices(expireTime)).not.to.be.reverted
    })

    it('Test expired time', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const expireTime = (await getBlockTimestamp()) + 90 // expire after 90 sec
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        // simulate: next block time 5 min
        await helpers.time.increase(5 * 60)

        // simulate relayNode fulfill request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        const prices = priceList[random(priceList.length)]
        await expect(relayNodeFulfill(relayNode, reqID, prices, 1.5, false)).to.be.revertedWith('request is expired')
    })

    it('Test refundRequest', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const beforeFundBalance = await weth.balanceOf(testOraclePrice.address)
        const beforeRelayNodeBalance = await weth.balanceOf(relayNode.address)

        const expireTime = (await getBlockTimestamp()) + 90 // expire after 90 sec
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        // simulate: next block time 5 min
        await helpers.time.increase(5 * 60)

        // simulate: received emit request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        await miOracle.connect(relayNode).refundRequest(reqID)

        // check status 3 = refund
        expect((await miOracle.getRequest(reqID))[3]).to.eq(3)

        // check req fee
        const fundBalance = await weth.balanceOf(testOraclePrice.address)
        const relayNodeBalance = await weth.balanceOf(relayNode.address)

        expect(beforeFundBalance).to.eq(fundBalance)
        expect(beforeRelayNodeBalance).to.eq(relayNodeBalance)
    })

    it('Test adminRefundRequest', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const beforeFundBalance = await weth.balanceOf(testOraclePrice.address)
        const beforeRelayNodeBalance = await weth.balanceOf(relayNode.address)

        const expireTime = (await getBlockTimestamp()) + 90 // expire after 90 sec
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        // simulate: next block time 5 min
        await helpers.time.increase(5 * 60)

        // simulate: received emit request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        await miOracle.connect(deployer).adminRefundRequest(reqID)

        // check req fee
        const fundBalance = await weth.balanceOf(testOraclePrice.address)
        const relayNodeBalance = await weth.balanceOf(relayNode.address)

        expect(beforeFundBalance).to.eq(fundBalance)
        expect(beforeRelayNodeBalance).to.eq(relayNodeBalance)
    })

    it('Test setPrice signer duplicate', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const expireTime = (await getBlockTimestamp()) + 90 // expire after 90 sec
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        // simulate relayNode fulfill request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        const request = await getRequest(reqID)
        const timestamp = request.timestamp.toString()
        const data = await makePriceFeedData(1.5, timestamp)
        const dataDuplicate = [...data, ...data]

        const tx = await miOracle.connect(relayNode).fulfillRequest(dataDuplicate, reqID)
        await expect(tx).to.emit(miOracle, 'FulfillRequest').withArgs(reqID, false, 'setPrices: signer duplicate')
    })

    it('Test signers under threshold', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        // add signer
        await miOracle.setSigner(user1.address, true)
        await miOracle.setSigner(user2.address, true)

        const totalSigner = await miOracle.totalSigner()
        await miOracle.setThreshold(totalSigner)

        // updatePrice
        const expireTime = 0
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        // simulate relayNode fulfill request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        const prices = priceList[random(priceList.length)]
        const call = await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)
        await expect(call.tx).to.emit(miOracle, 'FulfillRequest').withArgs(reqID, false, 'setPrices: signers under threshold')

        // remove signer
        await miOracle.setSigner(user1.address, false)
        await miOracle.setSigner(user2.address, false)

        expect(await miOracle.threshold()).eq(signers.length)
    })

    it('Test prices count of signer is not equal', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        // remove price of tokenIndex from signer data
        const testCase = [
            { signerIndex: 1, tokenIndex: 2 },
            { signerIndex: 2, tokenIndex: 0 },
            { signerIndex: 0, tokenIndex: 0 },
        ]

        for (const test of testCase) {
            // updatePrice
            const expireTime = 0
            await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

            const reqID = await miOracle.reqId() // last reqId (assume only one used)
            const request = await getRequest(reqID)

            // simulate: next block time 120 sec
            await helpers.time.increase(120)

            const timestamp = request.timestamp.toString()
            let data = await makePriceFeedData(1.5, timestamp, (signerIndex, prices) => {
                // remove some price from signer
                if (signerIndex == test.signerIndex) {
                    return prices.filter((item) => item.tokenIndex != test.tokenIndex)
                }
                return prices
            })

            let tx = await miOracle.connect(relayNode).fulfillRequest(data, reqID)
            await expect(tx).to.emit(miOracle, 'FulfillRequest').withArgs(reqID, false, 'setPrices: prices count of signer is not equal')
        }
    })

    it('Gas used requestPrices', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        // updatePrice
        const expireTime = 0
        await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

        const balance1 = await ethers.provider.getBalance(relayNode.address)

        // simulate relayNode fulfill request
        const reqID = await miOracle.reqId() // last reqId (assume only one used)
        const prices = priceList[random(priceList.length)]
        await relayNodeFulfill(relayNode, reqID, prices, 1.5, false)

        const balance2 = await ethers.provider.getBalance(relayNode.address)
        console.log(`gas used: ${toETH(balance1 - balance2)}`)
        // 0.000957699999137792 - feed 3 token
        // 0.000983330000470016 - feed 3 token + emit UpdatePrice (+0.000008543333777 per token)
    })

    it('Test Estimate gasUsed', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const lastPriceBefore = await miOracle.getLastPrice(tokenIndexes.BTC)

        // make params
        const to = testOraclePrice.address
        const payload = '0x0000000000000000000000000000000000000000000000000000000000000000'
        const data = await makePriceFeedData(1.5)

        try {
            await miOracle.connect(user1).callStatic.estimateGasUsed(to, payload, data)
        } catch (error) {
            // error.reason => {"gasUsed":434794,"msg":""}
            const result = JSON.parse(error.reason)
            console.log(`estimateGasUsed`, result)

            expect(result.gasUsed).to.greaterThan(1)
            expect(result.msg).to.eq('')
        }

        // test require execution reverted
        await expect(miOracle.connect(user1).estimateGasUsed(testOraclePrice.address, payload, data)).to.be.reverted
        await expect(miOracle.connect(user1).estimateGasUsed('0x0000000000000000000000000000', '0x0', [])).to.be.reverted

        const lastPriceAfter = await miOracle.getLastPrice(tokenIndexes.BTC)
        expect(lastPriceAfter[0]).to.eq(lastPriceBefore[0])
        expect(lastPriceAfter[1]).to.eq(lastPriceBefore[1])
        expect(lastPriceAfter[2]).to.eq(lastPriceBefore[2])
        expect(lastPriceAfter[3]).to.eq(lastPriceBefore[3])
    })

    it('Test Upgrade miOracle logic', async function () {
        const [deployer, proxyAdmin, relayNode, user1, user2] = await ethers.getSigners()

        const MiOracle = await ethers.getContractFactory('MiOracle')
        const TestUpgradeMiOracle = await ethers.getContractFactory('TestUpgradeMiOracle')
        const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')

        let reqID = await miOracle.reqId()

        // deploy new logic
        const miOracle_new_logic = await TestUpgradeMiOracle.deploy()

        // proxy upgrade new logic
        await miOracle_proxy.connect(proxyAdmin).upgradeTo(miOracle_new_logic.address)
        miOracle = TestUpgradeMiOracle.attach(miOracle_proxy.address)

        // set dummy data
        {
            await miOracle.setDummy(0, user1.address)
            await miOracle.setDummy(1, user2.address)
        }

        expect((await miOracle.dummy(0)).id).to.eq(0)
        expect((await miOracle.dummy(0)).owner).to.eq(user1.address)
        expect((await miOracle.dummy(1)).id).to.eq(1)
        expect((await miOracle.dummy(1)).owner).to.eq(user2.address)

        expect(await miOracle.owner()).to.eq(deployer.address)
        expect(await miOracle.weth()).to.eq(weth.address)
        expect(await miOracle.reqId()).to.eq(reqID)

        // fulfillRequest
        {
            // updatePrice
            const expireTime = 0
            const tx = await testOraclePrice.connect(user1).requestUpdatePrices(expireTime)

            reqID = await miOracle.reqId() // last reqId (assume only one used)
            let request = await miOracle.getRequest(reqID)
            request = {
                timestamp: request[0],
                owner: request[1],
                payload: request[2],
                status: request[3],
                expiration: request[4],
                block_timestamp: request[5],
                paymentAvailable: request[6],
            }

            const block1 = await ethers.provider.getBlock(tx.blockNumber)
            expect(request.block_timestamp).eq(block1.timestamp)

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
                expect(await testOraclePrice.getTokenPrice(tokenIndex)).eq(price)
                expect(timestamp).eq(block2.timestamp)

                // check price is latestPrice
                expect(price).to.eq(latestPrice)

                // check priceFeed
                const priceFeed = PriceFeedStore.attach(await miOracle.priceFeedStores(tokenIndex))
                expect(await priceFeed.latestTimestamp()).eq(request.timestamp.toString())
                expect((await priceFeed.getLastPrice())[1]).eq(price)
                expect((await priceFeed.getLastPrice())[2]).eq(latestPrice)
                expect((await priceFeed.getLastPrice())[3]).eq(block2.timestamp)
            }
        }

        // proxy downgrade previous logic
        await miOracle_proxy.connect(proxyAdmin).upgradeTo(miOracle_logic.address)
        miOracle = MiOracle.attach(miOracle_proxy.address)

        expect(await miOracle.owner()).to.eq(deployer.address)
        expect(await miOracle.weth()).to.eq(weth.address)
        expect(await miOracle.reqId()).to.eq(reqID)
    })
})

function makeSigner(total) {
    for (i = 0; i < total; i++) {
        const privateKey = crypto.randomBytes(32).toString('hex')
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
        { tokenIndex: 3, price: 1 },
        { tokenIndex: 4, price: 0.99 },
        { tokenIndex: 5, price: 0.99 },
    ]
    priceList[1] = [
        { tokenIndex: 0, price: 16611.25 },
        { tokenIndex: 1, price: 1222.1 },
        { tokenIndex: 2, price: 315.9 },
        { tokenIndex: 3, price: 1 },
        { tokenIndex: 4, price: 1 },
        { tokenIndex: 5, price: 1 },
    ]
    priceList[2] = [
        { tokenIndex: 0, price: 16600.02 },
        { tokenIndex: 1, price: 1223.22 },
        { tokenIndex: 2, price: 317.15 },
        { tokenIndex: 3, price: 0.99 },
        { tokenIndex: 4, price: 0.99 },
        { tokenIndex: 5, price: 1 },
    ]
    priceList[3] = [
        { tokenIndex: 0, price: 16248.38 },
        { tokenIndex: 1, price: 1148.925 },
        { tokenIndex: 2, price: 302.211 },
        { tokenIndex: 3, price: 1 },
        { tokenIndex: 4, price: 1 },
        { tokenIndex: 5, price: 1 },
    ]
    priceList[4] = [
        { tokenIndex: 0, price: 17020.226 },
        { tokenIndex: 1, price: 1254.117 },
        { tokenIndex: 2, price: 325.11 },
        { tokenIndex: 3, price: 0.98 },
        { tokenIndex: 4, price: 0.99 },
        { tokenIndex: 5, price: 0.99 },
    ]
    priceList[5] = [
        { tokenIndex: 0, price: 15912.325 },
        { tokenIndex: 1, price: 1129.33 },
        { tokenIndex: 2, price: 297.3 },
        { tokenIndex: 3, price: 1.01 },
        { tokenIndex: 4, price: 1 },
        { tokenIndex: 5, price: 0.98 },
    ]
}

async function makePriceFeedData(slippage = 0, timestamp = 0, callback = undefined) {
    const prices = priceList[random(priceList.length)]
    if (timestamp == 0) {
        timestamp = await getBlockTimestamp()
    }

    let signerIndex = 0
    return await Promise.all(
        signers.map(async (signer) => {
            // make price slippage
            let priceSlippage = randomPriceSlippage(prices, slippage)

            // callback to manual manipulate price before signed
            if (callback) {
                priceSlippage = callback(signerIndex, priceSlippage)
                signerIndex++
            }

            return makePriceFeed(signer, timestamp, priceSlippage)
        })
    )
}

async function getRequest(reqID) {
    const request = await miOracle.getRequest(reqID)
    return {
        timestamp: request[0],
        owner: request[1],
        payload: request[2],
        status: request[3],
        expiration: request[4],
        paymentAvailable: request[5],
    }
}

// simulate relayNode fulfill from request
async function relayNodeFulfill(relayNode, reqID, prices, slippage, checkLastPrice) {
    var accumulatePrices = {}

    // simulate: next block time 10 sec
    await helpers.time.increase(10)

    // simulate: received emit request
    const request = await getRequest(reqID)
    const timestamp = request.timestamp.toString()

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
