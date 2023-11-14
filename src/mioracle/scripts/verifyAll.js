const network = process.env.HARDHAT_NETWORK || 'mainnet'
const { deployedAddress, getContractAddress } = require('./lib/deploy')
const { config } = require('../config')
const { exec } = require('child_process')

let isDone = false
let errors = []

function makeParameter(name) {
  var param = []
  if (name == 'MiOracle') {
    param = [getContractAddress('miOracle_logic'), config.proxyAdmin, '0x']
  } else if (name == 'BTC/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'BTC/USD Price Feed', 0, 8]
  } else if (name == 'ETH/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'ETH/USD Price Feed', 1, 8]
  } else if (name == 'BNB/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'BNB/USD Price Feed', 2, 8]
  } else if (name == 'USDT/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'USDT/USD Price Feed', 3, 8]
  } else if (name == 'BUSD/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'BUSD/USD Price Feed', 4, 8]
  } else if (name == 'USDC/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'USDC/USD Price Feed', 5, 8]
  } else if (name == 'DAI/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'DAI/USD Price Feed', 6, 8]
  } else if (name == 'XRP/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'XRP/USD Price Feed', 10, 8]
  } else if (name == 'DOGE/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'DOGE/USD Price Feed', 11, 8]
  } else if (name == 'TRX/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'TRX/USD Price Feed', 12, 8]
  } else if (name == 'ADA/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'ADA/USD Price Feed', 20, 8]
  } else if (name == 'MATIC/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'MATIC/USD Price Feed', 21, 8]
  } else if (name == 'SOL/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'SOL/USD Price Feed', 22, 8]
  } else if (name == 'DOT/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'DOT/USD Price Feed', 23, 8]
  } else if (name == 'AJAX/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'AJAX/USD Price Feed', 24, 8]
  } else if (name == 'FTM/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'FTM/USD Price Feed', 25, 8]
  } else if (name == 'NEAR/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'NEAR/USD Price Feed', 26, 8]
  } else if (name == 'ATOM/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'ATOM/USD Price Feed', 27, 8]
  } else if (name == 'OP/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'OP/USD Price Feed', 28, 8]
  } else if (name == 'ARB/USD PriceFeed') {
    param = [getContractAddress('miOracle'), 'ARB/USD Price Feed', 29, 8]
  }

  if (param.length != 0) {
    return '"' + param.join('" "') + '"'
  }
  return ''
}

function verify(i, contractName, contractAddress) {
  const length = contractName.length
  if (i == length) {
    isDone = true
    return
  }

  const name = contractName[i]
  const address = contractAddress[i]

  const params = makeParameter(name)
  const cmd = `npx hardhat verify ${address} ${params} --network ${network}`
  console.log(`🚀 [${i + 1}/${length} ${name}] ${cmd}`)

  exec(cmd, (error, stdout, stderr) => {
    if (stdout.indexOf('Successfully submitted') != -1) {
      console.log(`✅ verified: ${stdout}`)
    } else {
      if (error || stderr) {
        const errMsg = error ? error.message : stderr ? stderr : ''
        if (errMsg.indexOf('Smart-contract already verified.') == -1) {
          console.log(`❌ error: ${errMsg}`)
          errors.push(`[${contractName[i]} - ${contractAddress[i]}]: ${errMsg}`)
        } else {
          console.log(`✅ skip verified: ${errMsg}`)
        }
      }
      console.log(`${stdout}`)
    }

    // recursive
    verify(i + 1, contractName, contractAddress)
  })
}

async function main() {
  const contractName = Object.keys(deployedAddress)
  const contractAddress = Object.values(deployedAddress)
  // recursive verify
  const start = 0
  verify(start, contractName, contractAddress)

  // wait for all done
  while (!isDone) {
    await sleep(1000)
  }

  console.log(`🌈 Done.`)
  if (errors.length > 0) {
    console.log(`❌ verify error: ${errors.length}`)
    errors.map((err) => console.log(err))
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
