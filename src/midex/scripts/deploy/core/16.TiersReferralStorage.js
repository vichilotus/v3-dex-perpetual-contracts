const { contractAt, sendTxn, getFrameSigner, getContractAddress } = require('../../shared/helpers')

async function getValues() {
    const signer = await getFrameSigner()
    const referralStorage = await contractAt('ReferralStorage', getContractAddress('referralStorage'), signer)
    const timeLock = await contractAt('TimeLock', getContractAddress('timeLock'), signer)

    return { referralStorage, timeLock }
}

async function main() {
    const { referralStorage, timeLock } = await getValues()

    await sendTxn(referralStorage.setTier(0, 1000, 5000), 'referralStorage.setTier 0')
    await sendTxn(referralStorage.setTier(1, 2000, 5000), 'referralStorage.setTier 1')
    await sendTxn(referralStorage.setTier(2, 2500, 4000), 'referralStorage.setTier 2')

    // set governance
    await sendTxn(referralStorage.transferGovernance(timeLock.address), 'referralStorage.transferGovernance')
    await sendTxn(timeLock.acceptGovernance(referralStorage.address), 'timeLock.acceptGovernance')

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
