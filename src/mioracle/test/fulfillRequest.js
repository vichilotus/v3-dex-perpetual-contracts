const { expect } = require('chai')
const { toWei, toETH, getJSONRequest, sleep } = require('../scripts/lib/helper.js')
const { config } = require('../config')

// check end with slash (/)
const api = config.priceFeedApi.endsWith('/') ? config.priceFeedApi : config.priceFeedApi + '/'
const tokenIndexes = {
  BTC: 0,
  ETH: 1,
  BNB: 2,
  USDT: 3,
  BUSD: 4,
  USDC: 5,
  DAI: 6,
  XRP: 10,
  DOGE: 11,
  TRX: 12,
  ADA: 20,
  MATIC: 21,
  SOL: 22,
  DOT: 23,
  AJAX: 24,
  FTM: 25,
  NEAR: 26,
  ATOM: 27,
  OP: 28,
  ARB: 29,
}

let miOracle
let weth
let simpleTrade
let reqId
let timestamp

describe('\n📌 ### Test miOracle FulfillRequest ###\n', function () {
  before('Deploy Contract', async function () {
    const [deployer, proxyAdmin, controller] = await ethers.getSigners()

    await deployMiOracle()

    const SimpleTrade = await ethers.getContractFactory('SimpleTrade')
    simpleTrade = await SimpleTrade.connect(deployer).deploy(miOracle.address, weth.address)

    // deposit reqFee
    await weth.connect(deployer).deposit({ value: ethers.utils.parseEther('1.0') })
    await weth.connect(deployer).transfer(simpleTrade.address, ethers.utils.parseEther('1.0')) // Sends 1.0 WETH
  })

  it('requestPrices', async function () {
    const [deployer, proxyAdmin, controller] = await ethers.getSigners()
    const currentReqId = await miOracle.reqId()

    // Mock contract to call requestPrices
    // open position (2 BTC)
    const tokenIndex = 0 // BTC
    const amount = 2
    await simpleTrade.connect(controller).openPosition(tokenIndex, toWei(amount))

    reqId = await miOracle.reqId()
    expect(reqId - 1).eq(currentReqId)

    const request = await getRequest(reqId)
    expect(request.status).eq(0) // 0 = request,  1 = fulfilled, 2 = cancel, 3 = refund

    timestamp = 1698131220
  })

  it('fulfillRequest', async function () {
    const [deployer, proxyAdmin, controller] = await ethers.getSigners()
    const url = `${api}${timestamp}`
    let data = []

    while (true) {
      console.log(`try request: ${url}`)
      data = await getJSONRequest(url)
      if (data.length >= 3) {
        break
      }
      await sleep(1000 * 15)
    }

    const priceFeeds = data.filter((priceFeed) => priceFeed.timestamp == timestamp)

    await miOracle.connect(controller).fulfillRequest(priceFeeds, reqId)

    const request = await getRequest(reqId)
    expect(request.status).eq(1) // 0 = request,  1 = fulfilled, 2 = cancel, 3 = refund

    // Check mock contract
    const positionId = (await simpleTrade.lastPositionId()) - 1
    const position = await simpleTrade.getPosition(positionId)
    expect(position.status).eq(2) // 0 = pending, 1 = revert (can't open), 2 = open, 3 = closed

    // Log prices
    for (let tokenIndex of Object.values(tokenIndexes)) {
      const prices = await miOracle.getLastPrice(tokenIndex)
      console.log(tokenIndex, await miOracle.getPriceFeed(tokenIndex), 'round', +prices[0], 'price', +prices[1], 'latestPrice', +prices[2], 'timestamp', +prices[3])
    }
  })
})

async function deployMiOracle() {
  const [deployer, proxyAdmin, controller] = await ethers.getSigners()
  var list = []

  const WETH = await ethers.getContractFactory('WETH')

  // Deploy WETH
  weth = await WETH.deploy('Wrapped ETH', 'WETH')

  // deploy logic
  const MiOracle = await ethers.getContractFactory('MiOracle')
  const miOracle_logic = await MiOracle.deploy()

  // deploy proxy
  const AdminUpgradeabilityProxy = await ethers.getContractFactory('AdminUpgradeabilityProxy')
  const miOracle_proxy = await AdminUpgradeabilityProxy.deploy(miOracle_logic.address, proxyAdmin.address, '0x')

  // initialize
  miOracle = await MiOracle.attach(miOracle_proxy.address)
  await miOracle.initialize(weth.address)

  console.log(`miOracle: ${miOracle.address}`)

  let keys = Object.keys(tokenIndexes)
  let values = Object.values(tokenIndexes)

  // Deploy PriceFeedStore
  const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')
  for (let i = 0; i < Object.keys(tokenIndexes).length; i++) {
    let key = keys[i]
    const contract = await PriceFeedStore.connect(deployer).deploy(miOracle.address, `${key}/USD Price Feed`, values[i], 8)

    list.push({
      contract: contract,
      tokenIndex: tokenIndexes[key],
    })

    console.log(`${key}: ${contract.address}`)
  }

  for (let item of list) {
    await miOracle.connect(deployer).setPriceFeedStore(item.contract.address, item.tokenIndex)
  }

  // Set controller
  await miOracle.connect(deployer).setController(controller.address, true)

  // Set signer
  await miOracle.connect(deployer).setSigner(config.priceFeedSigners[0], true)
  await miOracle.connect(deployer).setSigner(config.priceFeedSigners[1], true)
  await miOracle.connect(deployer).setSigner(config.priceFeedSigners[2], true)
  await miOracle.connect(deployer).setSigner(config.priceFeedSigners[3], true)
  await miOracle.connect(deployer).setThreshold(3)
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
