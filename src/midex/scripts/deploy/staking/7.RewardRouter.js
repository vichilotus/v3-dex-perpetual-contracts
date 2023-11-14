const { deployContract, contractAt, sendTxn, writeDeployedAddresses, getFrameSigner, getContractAddress } = require('../../shared/helpers')

const network = process.env.HARDHAT_NETWORK || 'mainnet'
const tokens = require('../../shared/tokens')[network]

async function main() {
    const { nativeToken } = tokens
    const signer = await getFrameSigner()
    const minRewardCompound = '10000000000000000' // 0.01 = $15 ETH $1500

    const milpManager = await contractAt('MilpManager', getContractAddress('milpManager'), signer)
    const milp = await contractAt('MILP', getContractAddress('milp'), signer)

    await sendTxn(milp.setInPrivateTransferMode(true), 'milp.setInPrivateTransferMode')

    const feeMilpTracker = await deployContract('RewardTracker', ['Fee MILP', 'fMILP'], 'fMILP (Fee MILP)', signer)
    const feeMilpDistributor = await deployContract('RewardDistributor', [nativeToken.address, feeMilpTracker.address], 'feeMilpDistributor', signer)

    await sendTxn(feeMilpTracker.initialize([milp.address], feeMilpDistributor.address), 'feeMilpTracker.initialize')
    await sendTxn(feeMilpDistributor.updateLastDistributionTime(), 'feeMilpDistributor.updateLastDistributionTime')

    await sendTxn(feeMilpTracker.setInPrivateTransferMode(true), 'feeMilpTracker.setInPrivateTransferMode')
    await sendTxn(feeMilpTracker.setInPrivateStakingMode(true), 'feeMilpTracker.setInPrivateStakingMode')

    const rewardRouter = await deployContract('RewardRouter', [], 'RewardRouter', signer)

    await sendTxn(
        rewardRouter.initialize(nativeToken.address, milp.address, feeMilpTracker.address, milpManager.address, minRewardCompound),
        'rewardRouter.initialize'
    )

    await sendTxn(milpManager.setHandler(rewardRouter.address, true), 'milpManager.setHandler(rewardRouter)')

    // allow feeMilpTracker to stake milp
    await sendTxn(milp.setHandler(feeMilpTracker.address, true), 'milp.setHandler(feeMilpTracker)')

    // allow rewardRouter to stake in feeMilpTracker
    await sendTxn(feeMilpTracker.setHandler(rewardRouter.address, true), 'feeMilpTracker.setHandler(rewardRouter)')
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
