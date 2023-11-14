const { expect } = require('chai')
const helpers = require('@nomicfoundation/hardhat-network-helpers')
const crypto = require('crypto')

const tokenIndexes = {
  BTC: 0,
  ETH: 1,
  BNB: 2,
  USDT: 3,
  BUSD: 4,
  USDC: 5,
  DOGE: 6,
}

let priceList = []
let signers = []
let miOracle
let weth
let requestPrices
const fulfillFee = 3000 // 30%
const minFeeBalance = 0.02 * 10 ** 9

describe('\n📌 ### Test Example: Request Prices ###\n', function () {
  before('Initial data', async function () {
    console.log('👻 make signers')
    makeSigner(3)

    console.log('👻 make price list')
    makePriceList()
  })

  before('Deploy MiOracle Contract', async function () {
    const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()

    const WETH = await ethers.getContractFactory('WETH')
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

    const PriceFeedStore = await ethers.getContractFactory('PriceFeedStore')
    const btcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BTC/USD Price Feed', tokenIndexes.BTC, 8)
    const ethPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'ETH/USD Price Feed', tokenIndexes.ETH, 8)
    const bnbPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BNB/USD Price Feed', tokenIndexes.BNB, 8)
    const usdtPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDT/USD Price Feed', tokenIndexes.USDT, 8)
    const busdPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'BUSD/USD Price Feed', tokenIndexes.BUSD, 8)
    const usdcPriceFeed = await PriceFeedStore.deploy(miOracle.address, 'USDC/USD Price Feed', tokenIndexes.USDC, 8)
    const dogePriceFeed = await PriceFeedStore.deploy(miOracle.address, 'DOGE/USD Price Feed', tokenIndexes.DOGE, 8)

    await miOracle.setPriceFeedStore(btcPriceFeed.address, tokenIndexes.BTC)
    await miOracle.setPriceFeedStore(ethPriceFeed.address, tokenIndexes.ETH)
    await miOracle.setPriceFeedStore(bnbPriceFeed.address, tokenIndexes.BNB)
    await miOracle.setPriceFeedStore(usdtPriceFeed.address, tokenIndexes.USDT)
    await miOracle.setPriceFeedStore(busdPriceFeed.address, tokenIndexes.BUSD)
    await miOracle.setPriceFeedStore(usdcPriceFeed.address, tokenIndexes.USDC)
    await miOracle.setPriceFeedStore(dogePriceFeed.address, tokenIndexes.DOGE)

    await miOracle.setController(relayNode.address, true)

    for (i = 0; i < signers.length; i++) {
      await miOracle.setSigner(signers[i].publicAddress, true)
    }

    // set reqFee
    await miOracle.setFulfillFee(fulfillFee)
    await miOracle.setMinFeeBalance(minFeeBalance)

    const decimals = await miOracle.getDecimals(tokenIndexes.BTC)
    pricePrecision = 10 ** parseInt(decimals)
  })

  before('Deploy RequestPrices Contract', async function () {
    const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()

    const RequestPrices = await ethers.getContractFactory('RequestPrices')
    requestPrices = await RequestPrices.deploy(miOracle.address, weth.address)

    // deposit reqFee
    await weth.deposit({ value: ethers.utils.parseEther('1.0') })
    await weth.transfer(requestPrices.address, ethers.utils.parseEther('1.0')) // Sends 1.0 WETH
  })

  it('requestPrices and getPrices', async function () {
    const [deployer, proxyAdmin, relayNode] = await ethers.getSigners()

    // 1 send requestPrices
    await requestPrices.requestPrices()

    // 2 simulate relayNode fulfill request
    const prices = priceList[random(2)] // priceList 0, 1, 2
    await relayNodeFulfill(relayNode, prices) // no slippage

    // 3 check result
    for (const [symbol, tokenIndex] of Object.entries(tokenIndexes)) {
      const price = await requestPrices.getPrice(tokenIndex)
      const lastPrice = await miOracle.getLastPrice(tokenIndex)

      expect(price).eq(adjustPrice(prices[tokenIndex].price))
      expect(price).eq(lastPrice[1])
    }
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
    { tokenIndex: 3, price: 1.0001 },
    { tokenIndex: 4, price: 1.0001 },
    { tokenIndex: 5, price: 1.0001 },
    { tokenIndex: 6, price: 0.0664 },
  ]
  priceList[1] = [
    { tokenIndex: 0, price: 16611.25 },
    { tokenIndex: 1, price: 1222.1 },
    { tokenIndex: 2, price: 315.9 },
    { tokenIndex: 3, price: 1.0005 },
    { tokenIndex: 4, price: 0.999 },
    { tokenIndex: 5, price: 1.0 },
    { tokenIndex: 6, price: 0.0634 },
  ]
  priceList[2] = [
    { tokenIndex: 0, price: 16600.02 },
    { tokenIndex: 1, price: 1223.22 },
    { tokenIndex: 2, price: 317.15 },
    { tokenIndex: 3, price: 0.99 },
    { tokenIndex: 4, price: 0.989 },
    { tokenIndex: 5, price: 0.998 },
    { tokenIndex: 6, price: 0.07 },
  ]
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
async function relayNodeFulfill(relayNode, prices, slippage = 0, checkLastPrice = true) {
  var accumulatePrices = {}

  // simulate: next block time 10 sec
  await helpers.time.increase(10)

  // simulate: received emit request
  const reqID = await miOracle.reqId() // last reqId (assume only one used)
  const request = await getRequest(reqID)
  const timestamp = request.timestamp.toString()

  const data = await Promise.all(
    await signers.map(async (signer) => {
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

  const call = await miOracle.connect(relayNode).fulfillRequest(data, reqID)

  if (checkLastPrice) {
    // find mean price for expect test
    await Object.keys(accumulatePrices).forEach(async (tokenIndex) => {
      const meanPrice = accumulatePrices[tokenIndex] / signers.length
      const lastPrice = await miOracle.getLastPrice(tokenIndex)

      expect(Math.abs(lastPrice[1] - adjustPrice(meanPrice))).lessThan(2)
      expect(lastPrice[2]).eq(timestamp)
    })
  }

  return call
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
