const { deployContract, contractAt, sendTxn, getContractAddress, getFrameSigner, sleep, expandDecimals } = require('../shared/helpers')
const network = process.env.HARDHAT_NETWORK || 'mainnet'
const tokens = require('../shared/tokens')[network]

async function main() {
    const { nativeToken } = tokens
    const signer = await getFrameSigner()
    const minRewardCompound = '10000000000000000' // 0.01 = $15 ETH $1500

    const milpManager = await contractAt('MilpManager', getContractAddress('milpManager'), signer)
    const milp = await contractAt('MILP', getContractAddress('milp'), signer)
    const feeMilpTracker = await contractAt('RewardTracker', getContractAddress('fMILP'))
    const prevRewardRouter = await contractAt('RewardRouter', getContractAddress('rewardRouter'))
    const fulfillController = await contractAt('FulfillController', getContractAddress('fulfillController'), signer)

    console.log(`🪄 Upgrade RewardRouter`)

    // ------------------------------
    // remove previous
    // ------------------------------
    await sendTxn(milpManager.setHandler(prevRewardRouter.address, false), 'milpManager.setHandler(prevRewardRouter)')
    await sendTxn(feeMilpTracker.setHandler(prevRewardRouter.address, false), 'feeMilpTracker.setHandler(prevRewardRouter)')
    await sendTxn(fulfillController.setHandler(prevRewardRouter.address, false), `fulfillController.setHandler(prevRewardRouter)`)

    // ------------------------------
    // deploy
    // ------------------------------
    // deploy rewardRouter
    const rewardRouter = await deployContract('RewardRouter', [], 'RewardRouter', signer)

    // initialize
    await sendTxn(
        rewardRouter.initialize(nativeToken.address, milp.address, feeMilpTracker.address, milpManager.address, minRewardCompound),
        'rewardRouter.initialize'
    )

    // set fulfill controller
    await sendTxn(rewardRouter.setFulfillController(fulfillController.address), `rewardRouter.setFulfillController`)

    // ------------------------------
    // migrate
    // ------------------------------
    await sendTxn(milpManager.setHandler(rewardRouter.address, true), 'milpManager.setHandler(rewardRouter)')
    await sendTxn(feeMilpTracker.setHandler(rewardRouter.address, true), 'feeMilpTracker.setHandler(rewardRouter)')
    await sendTxn(fulfillController.setHandler(rewardRouter.address, true), `fulfillController.setHandler(positionRouter)`)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
