const { deployContract, contractAt, sendTxn, getContractAddress, getFrameSigner, sleep, expandDecimals } = require('../shared/helpers')
const network = process.env.HARDHAT_NETWORK || 'mainnet'
const tokens = require('../shared/tokens')[network]

async function main() {
    const { btc, eth, bnb, busd, usdc, matic, op, arb } = tokens
    const tokenArr = [btc, eth, bnb, busd, usdc, matic, op, arb]

    const signer = await getFrameSigner()

    const vaultPriceFeed = await contractAt('VaultPriceFeed', getContractAddress('vaultPriceFeed'), signer)
    let timeLock

    console.log(`🪄 Upgrade VaultPriceFeed to ${vaultPriceFeed.address}`)

    // transferGovernance to deployer
    timeLock = await contractAt('TimeLock', getContractAddress('timeLock'), signer)
    await sendTxn(timeLock.signalTransferGovernance(vaultPriceFeed.address, signer.address), `timeLock.signalTransferGovernance(router)`)

    console.log(`wait for timeLock...`)
    await sleep(1000 * 60 * 5.1) // wait 5.1 mins

    await sendTxn(timeLock.transferGovernance(vaultPriceFeed.address, signer.address), `timeLock.transferGovernance(router)`)
    await sendTxn(vaultPriceFeed.acceptGovernance(), `vaultPriceFeed.acceptGovernance()`)

    // whitelist tokens
    for (const token of tokenArr) {
        console.log('setTokenConfig:', token.name)

        await sendTxn(
            vaultPriceFeed.setTokenConfig(
                token.address, // _token
                token.priceFeed, // _priceFeed
                token.priceDecimals, // _priceDecimals
                token.isStrictStable // _isStrictStable
            ),
            `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`
        )
    }

    // Set timeLock
    await sendTxn(vaultPriceFeed.transferGovernance(timeLock.address), `vaultPriceFeed.transferGovernance(timeLock)`)
    await sendTxn(timeLock.acceptGovernance(vaultPriceFeed.address), `timeLock.acceptGovernance(vaultPriceFeed.address)`)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
