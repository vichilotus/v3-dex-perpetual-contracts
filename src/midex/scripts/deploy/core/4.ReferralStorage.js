const { getFrameSigner, deployContract, contractAt, sendTxn, readDeployedAddresses, writeDeployedAddresses } = require('../../shared/helpers')

async function main() {
    const signer = await getFrameSigner()
    const referralStorage = await deployContract('ReferralStorage', [], '', signer)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
