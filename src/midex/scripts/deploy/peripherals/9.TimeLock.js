const { deployContract, contractAt, sendTxn, getFrameSigner, getContractAddress, expandDecimals } = require('../../shared/helpers')

async function main() {
    const signer = await getFrameSigner()

    const admin = getContractAddress('deployer')
    const buffer = 5 * 60 // 24 * 60 * 60
    const rewardManager = { address: ethers.constants.AddressZero }
    const maxTokenSupply = expandDecimals('1000000', 18)

    const vault = await contractAt('Vault', getContractAddress('vault'), signer)
    const vaultPriceFeed = await contractAt('VaultPriceFeed', await vault.priceFeed(), signer)
    const router = await contractAt('Router', getContractAddress('router'), signer)
    const tokenManager = { address: getContractAddress('tokenManager') }
    const mintReceiver = { address: getContractAddress('mintReceiver') }
    const positionRouter = await contractAt('PositionRouter', await getContractAddress('positionRouter'), signer)
    const positionManager = await contractAt('PositionManager', await getContractAddress('positionManager'), signer)

    const timeLock = await deployContract(
        'TimeLock',
        [
            admin,
            buffer,
            rewardManager.address,
            tokenManager.address,
            mintReceiver.address,
            maxTokenSupply,
            10, // marginFeeBasisPoints 0.1%
            100, // maxMarginFeeBasisPoints 1%
        ],
        'TimeLock',
        signer
    )

    // set Governance
    await sendTxn(vault.transferGovernance(timeLock.address), 'vault.transferGovernance')
    await sendTxn(timeLock.acceptGovernance(vault.address), `timeLock.acceptGovernance(vault.address)`)
    await sendTxn(vaultPriceFeed.transferGovernance(timeLock.address), 'vaultPriceFeed.transferGovernance')
    await sendTxn(timeLock.acceptGovernance(vaultPriceFeed.address), `timeLock.acceptGovernance(vaultPriceFeed.address)`)
    await sendTxn(router.transferGovernance(timeLock.address), 'router.transferGovernance')
    await sendTxn(timeLock.acceptGovernance(router.address), `timeLock.acceptGovernance(router.address)`)

    // set timeLock
    await sendTxn(timeLock.setShouldToggleIsLeverageEnabled(true), 'timeLock.setShouldToggleIsLeverageEnabled(true)')
    await sendTxn(timeLock.setContractHandler(positionRouter.address, true), 'timeLock.setContractHandler(positionRouter)')
    await sendTxn(timeLock.setContractHandler(positionManager.address, true), 'timeLock.setContractHandler(positionManager)')
    await sendTxn(timeLock.setLiquidator(vault.address, positionManager.address, true), 'timeLock.setLiquidator(vault, positionManager, true)')

    const signers = [getContractAddress('deployer'), getContractAddress('signer2'), getContractAddress('signer3')]

    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i]
        await sendTxn(timeLock.setContractHandler(signer, true), `timeLock.setContractHandler(${signer})`)
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
