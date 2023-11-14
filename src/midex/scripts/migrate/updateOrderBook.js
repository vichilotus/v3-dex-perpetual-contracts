const { deployContract, contractAt, sendTxn, getContractAddress, getFrameSigner, sleep, expandDecimals } = require('../shared/helpers')
const network = process.env.HARDHAT_NETWORK || 'mainnet'
const tokens = require('../shared/tokens')[network]

async function main() {
    const signer = await getFrameSigner()

    const vault = await contractAt('Vault', getContractAddress('vault'))
    const vaultPositionController = await contractAt('VaultPositionController', getContractAddress('vaultPositionController'))
    const router = await contractAt('Router', getContractAddress('router'), signer)
    const weth = await contractAt('WETH', tokens.nativeToken.address)
    const depositFee = 30 // 0.3%
    const orderKeeper = { address: getContractAddress('keeper') }
    const liquidator = { address: getContractAddress('liquidator') }
    const musd = { address: getContractAddress('musd') }
    const prevOrderBook = await contractAt('OrderBook', getContractAddress('orderBook'))
    const prevPositionManager = await contractAt('PositionManager', getContractAddress('positionManager'))
    const fulfillController = await contractAt('FulfillController', getContractAddress('fulfillController'), signer)

    console.log(`🪄 Upgrade OrderBook, PositionManager`)

    // ------------------------------
    // timeLock transferGovernance
    // ------------------------------
    // transferGovernance to deployer
    const timeLock = await contractAt('TimeLock', getContractAddress('timeLock'), signer)
    await sendTxn(timeLock.signalTransferGovernance(router.address, signer.address), `timeLock.signalTransferGovernance(router)`)

    console.log(`wait for timeLock...`)
    await sleep(1000 * 60 * 5.1) // wait 5.1 mins

    await sendTxn(timeLock.transferGovernance(router.address, signer.address), `timeLock.transferGovernance(router)`)
    await sendTxn(router.acceptGovernance(), `router.acceptGovernance()`)

    // ------------------------------
    // deploy
    // ------------------------------
    // deploy positionManagerReader
    const positionManagerReader = await deployContract('PositionManagerReader', [], 'PositionManagerReader', signer)

    // deploy orderbook
    const orderBook = await deployContract('OrderBook', [], 'OrderBook', signer)

    // deploy orderBookOpenOrder
    const orderBookOpenOrder = await deployContract('OrderBookOpenOrder', [orderBook.address, vaultPositionController.address], 'OrderBookOpenOrder', signer)

    await sendTxn(
        orderBook.initialize(
            router.address,
            vault.address,
            vaultPositionController.address,
            orderBookOpenOrder.address,
            tokens.nativeToken.address, // weth
            musd.address, // musd
            '300000000000000', // 0.0003 BNB
            expandDecimals(10, 30) // min purchase token amount usd
        ),
        'orderBook.initialize'
    )

    // deploy positionManager
    const positionManager = await deployContract(
        'PositionManager',
        [vault.address, vaultPositionController.address, router.address, weth.address, depositFee, orderBook.address],
        '',
        signer
    )

    // ------------------------------
    // migrate
    // ------------------------------
    await sendTxn(positionManager.setOrderKeeper(orderKeeper.address, true), 'positionManager.setOrderKeeper(orderKeeper)')
    await sendTxn(positionManager.setLiquidator(liquidator.address, true), 'positionManager.setLiquidator(liquidator)')
    await sendTxn(positionManager.setIncreasePositionBufferBps(100), 'positionManager.setIncreasePositionBufferBps(100)')
    await sendTxn(positionManager.setShouldValidateIncreaseOrder(false), 'positionManager.setShouldValidateIncreaseOrder(false)')
    await sendTxn(positionManager.setMaxExecuteOrder(1), `positionManager.setMaxExecuteOrder(1)`)
    await sendTxn(positionManager.setFulfillController(fulfillController.address), `positionManager.setFulfillController`)

    await sendTxn(router.removePlugin(prevPositionManager.address), 'router.removePlugin(prevPositionManager)')
    await sendTxn(router.removePlugin(prevOrderBook.address), 'router.removePlugin(prevOrderBook)')

    await sendTxn(router.addPlugin(positionManager.address), 'router.addPlugin(positionManager)')
    await sendTxn(router.addPlugin(orderBook.address), 'router.addPlugin(orderBook)')

    await sendTxn(orderBook.setOrderExecutor(positionManager.address), 'orderBook.setOrderExecutor(positionManager)')
    await sendTxn(orderBook.setFulfillController(fulfillController.address), `orderBook.setFulfillController`)

    await sendTxn(fulfillController.setHandler(prevPositionManager.address, false), 'fulfillController.setHandler(prevPositionManager)')
    await sendTxn(fulfillController.setHandler(positionManager.address, true), 'fulfillController.setHandler(positionManager)')

    await sendTxn(fulfillController.setHandler(prevOrderBook.address, false), 'fulfillController.setHandler(prevOrderBook)')
    await sendTxn(fulfillController.setHandler(orderBook.address, true), `fulfillController.setHandler(orderBook)`)

    // ------------------------------
    // Set timeLock
    // ------------------------------
    await sendTxn(router.transferGovernance(timeLock.address), `router.transferGovernance(timeLock)`)
    await sendTxn(timeLock.acceptGovernance(router.address), `timeLock.acceptGovernance(router.address)`)

    await sendTxn(timeLock.setContractHandler(prevPositionManager.address, false), 'timeLock.setContractHandler(prevPositionManager)')
    await sendTxn(timeLock.setContractHandler(positionManager.address, true), 'timeLock.setContractHandler(positionManager)')

    await sendTxn(timeLock.setLiquidator(vault.address, prevPositionManager.address, false), 'timeLock.setLiquidator(vault, positionManager, false)')
    await sendTxn(timeLock.setLiquidator(vault.address, positionManager.address, true), 'timeLock.setLiquidator(vault, positionManager, true)')
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
