const { deployContract, contractAt, sendTxn, getContractAddress, getFrameSigner, sleep, expandDecimals } = require('../../shared/helpers')
const network = process.env.HARDHAT_NETWORK || 'mainnet'
const tokens = require('../../shared/tokens')[network]

async function main() {
    const { btc, eth, bnb, usdt, usdc, matic, op, arb, nativeToken } = tokens
    const tokenArr = [btc, eth, bnb, usdt, usdc, matic, op, arb]

    const signer = await getFrameSigner()

    const weth = await contractAt('Token', nativeToken.address, signer)
    const vault = await contractAt('Vault', getContractAddress('vault'), signer)
    const vaultPriceFeed = await contractAt('VaultPriceFeed', getContractAddress('vaultPriceFeed'), signer)
    const milpManager = await contractAt('MilpManager', getContractAddress('milpManager'), signer)
    const rewardRouter = await contractAt('RewardRouter', getContractAddress('rewardRouter'), signer)
    const router = await contractAt('Router', getContractAddress('router'), signer)
    const positionManager = await contractAt('PositionManager', getContractAddress('positionManager'), signer)
    const positionRouter = await contractAt('PositionRouter', getContractAddress('positionRouter'), signer)
    const orderBook = await contractAt('OrderBook', getContractAddress('orderBook'), signer)
    let timeLock

    const lastTaskId = 0
    const depositWETH = '0.001'

    // deploy FulfillController
    const fulfillController = await deployContract('FulfillController', [getContractAddress('miOracle'), nativeToken.address, lastTaskId], '', signer)

    const prevFulfillControllerAddress = await router.fulfillController()
    const isUpgradeFulfillController = prevFulfillControllerAddress.toLowerCase() != '0x0000000000000000000000000000000000000000'
    if (isUpgradeFulfillController) {
        console.log(`🪄 Upgrade FulfillController to ${fulfillController.address}`)

        // adminWithdraw
        const prevFulfillController = await contractAt('FulfillController', prevFulfillControllerAddress, signer)
        const prevFund = await weth.balanceOf(prevFulfillControllerAddress)
        await sendTxn(prevFulfillController.adminWithdraw(prevFund), `prevFulfillController.adminWithdraw(${prevFund})`)

        // transferGovernance to deployer
        timeLock = await contractAt('TimeLock', getContractAddress('timeLock'), signer)
        await sendTxn(timeLock.signalTransferGovernance(router.address, signer.address), `timeLock.signalTransferGovernance(router)`)

        console.log(`wait for timeLock...`)
        await sleep(1000 * 60 * 5.1) // wait 5.1 mins

        await sendTxn(timeLock.transferGovernance(router.address, signer.address), `timeLock.transferGovernance(router)`)
        await sendTxn(router.acceptGovernance(), `router.acceptGovernance()`)
    }

    // setFulfillController
    await sendTxn(milpManager.setFulfillController(fulfillController.address), `milpManager.setFulfillController`)
    await sendTxn(rewardRouter.setFulfillController(fulfillController.address), `rewardRouter.setFulfillController`)
    await sendTxn(router.setFulfillController(fulfillController.address), `router.setFulfillController`)
    await sendTxn(positionManager.setFulfillController(fulfillController.address), `positionManager.setFulfillController`)
    await sendTxn(positionRouter.setFulfillController(fulfillController.address, getContractAddress('feeReceiver')), `positionRouter.setFulfillController`)
    await sendTxn(orderBook.setFulfillController(fulfillController.address), `orderBook.setFulfillController`)

    // setHandler
    await sendTxn(fulfillController.setHandler(milpManager.address, true), `fulfillController.setHandler(${milpManager.address})`)
    await sendTxn(fulfillController.setHandler(rewardRouter.address, true), `fulfillController.setHandler(${rewardRouter.address})`)
    await sendTxn(fulfillController.setHandler(router.address, true), `fulfillController.setHandler(${router.address})`)
    await sendTxn(fulfillController.setHandler(positionManager.address, true), `fulfillController.setHandler(${positionManager.address})`)
    await sendTxn(fulfillController.setHandler(positionRouter.address, true), `fulfillController.setHandler(${positionRouter.address})`)
    await sendTxn(fulfillController.setHandler(orderBook.address, true), `fulfillController.setHandler(${orderBook.address})`)

    await sendTxn(positionManager.setMaxExecuteOrder(1), `positionManager.setMaxExecuteOrder(1)`)
    await sendTxn(positionManager.setOrderKeeper(getContractAddress('keeper'), true), `positionManager.setOrderKeeper(${getContractAddress('keeper')})`)
    await sendTxn(positionManager.setLiquidator(getContractAddress('liquidator'), true), `positionManager.setLiquidator(${getContractAddress('liquidator')})`)

    if (isUpgradeFulfillController) {
        // transferGovernance to timeLock
        await sendTxn(router.transferGovernance(timeLock.address), `router.transferGovernance(timeLock)`)
        await sendTxn(timeLock.acceptGovernance(router.address), `timeLock.acceptGovernance(router.address)`)
    } else {
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

            await sendTxn(
                vault.setTokenConfig(
                    token.address, // _token
                    token.decimals, // _tokenDecimals
                    token.tokenWeight, // _tokenWeight
                    token.minProfitBps, // _minProfitBps
                    expandDecimals(token.maxMusdAmount, 18), // _maxMusdAmount
                    token.isStable, // _isStable
                    token.isShortable // _isShortable
                ),
                `vault.setTokenConfig(${token.name}) ${token.address}`
            )
        }
    }

    // setController deployer and Call requestUpdatePrices
    await sendTxn(fulfillController.setController(signer.address, true), `fulfillController.setController(${signer.address})`)

    // wrap ETH and deposit fund
    await sendTxn(weth.deposit({ value: ethers.utils.parseEther(depositWETH) }), `weth.deposit(${depositWETH})`)
    await sendTxn(weth.transfer(fulfillController.address, ethers.utils.parseEther(depositWETH)), `weth.transfer(${fulfillController.address})`)

    // requestUpdatePrices
    await sendTxn(fulfillController.requestUpdatePrices(), `fulfillController.requestUpdatePrices()`)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
