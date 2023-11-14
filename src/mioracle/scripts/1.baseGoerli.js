const { deployContract, contractAt, getContractAddress, sendTxn, getFrameSigner } = require('./lib/deploy')
const { config } = require('../config')
const readline = require('readline')

async function main() {
  const deployer = await getFrameSigner()
  const proxyAdmin = config.proxyAdmin
  const relayNodes = config.relayNodes
  const priceFeedSigners = config.priceFeedSigners
  const wethAddress = getContractAddress('weth')

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
    AJAX: 14,
    FTM: 15,
    NEAR: 16,
    ATOM: 17,
    OP: 18,
    ARB: 19,
  }
  let list = []
  let miOracle

  // false = new deploy all contracts
  // true = migrate to new miOracle logic
  const isMigrate = false

  // deploy logic
  const miOracle_logic = await deployContract('MiOracle', [], 'MiOracle_logic', deployer)
  // const miOracle_logic = await contractAt("MiOracle", getContractAddress("miOracle_logic"), deployer);

  // miOracle
  if (!isMigrate) {
    // deploy proxy
    const miOracle_proxy = await deployContract('AdminUpgradeabilityProxy', [miOracle_logic.address, proxyAdmin, '0x'], 'MiOracle', deployer)
    // const miOracle_proxy = await contractAt("MiOracle", getContractAddress("miOracle"), deployer);

    // initialize
    miOracle = await contractAt('MiOracle', miOracle_proxy.address, deployer)
    await miOracle.initialize(wethAddress)
  } else {
    // to upgrade proxy in end for script
    miOracle = await contractAt('MiOracle', getContractAddress('miOracle'), deployer)
  }

  // PriceFeedStore
  if (!isMigrate) {
    // deploy
    let keys = Object.keys(tokenIndexes)
    let values = Object.values(tokenIndexes)
    for (let i = 0; i < Object.keys(tokenIndexes).length; i++) {
      let key = keys[i]
      const contract = await deployContract('PriceFeedStore', [miOracle.address, `${key}/USD Price Feed`, values[i], 8], `${key}/USD PriceFeed`, deployer)

      list.push({
        contract: contract,
        tokenIndex: tokenIndexes[key],
      })
    }
  } else {
    // get contracts
    let keys = Object.keys(tokenIndexes)
    for (let i = 0; i < Object.keys(tokenIndexes).length; i++) {
      let key = keys[i]
      let name = `${key.toLowerCase()}PriceFeed`
      const contract = await contractAt('PriceFeedStore', getContractAddress(name), deployer)

      list.push({
        contract: contract,
        tokenIndex: tokenIndexes[key],
      })
    }
  }

  for (let item of list) {
    await sendTxn(miOracle.setPriceFeedStore(item.contract.address, item.tokenIndex), `miOracle.setPriceFeedStore(${item.contract.address})`)
  }

  // set signer
  for (let i = 0; i < priceFeedSigners.length; i++) {
    await sendTxn(miOracle.setSigner(priceFeedSigners[i], true), `miOracle.setSigner(${priceFeedSigners[i]})`)
  }
  await sendTxn(miOracle.setThreshold(3), `miOracle.setThreshold(3)`)

  // set controller
  for (let i = 0; i < relayNodes.length; i++) {
    await sendTxn(miOracle.setController(relayNodes[i], true), `miOracle.setController(${relayNodes[i]})`)
  }

  // set reqFee
  await sendTxn(miOracle.setFulfillFee(fulfillFee), `miOracle.setFulfillFee(${fulfillFee})`)
  await sendTxn(miOracle.setMinFeeBalance(minFeeBalance), `miOracle.setMinFeeBalance(${minFeeBalance})`)

  // for upgrade proxy
  if (isMigrate) {
    // switch to proxyAdmin
    await switchSigner(proxyAdmin)

    // proxy upgrade new logic
    const miOracle_proxy = await contractAt('AdminUpgradeabilityProxy', getContractAddress('miOracle'), deployer)
    await sendTxn(miOracle_proxy.upgradeTo(miOracle_logic.address), `miOracle.upgradeTo(${miOracle_logic.address})`)

    // switch to deployer
    await switchSigner(`deployer`)
  }
}

async function switchSigner(address) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) =>
    rl.question(`wait for switch signer to ${address}\npress enter to continue...`, (ans) => {
      rl.close()
      resolve(ans)
    })
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
