const { contractAt, sendTxn, getContractAddress, getFrameSigner, expandDecimals } = require('../shared/helpers')

async function main() {
    const signer = await getFrameSigner()

    //token
    const btc = await contractAt('FaucetToken', getContractAddress('btc'), signer)
    const bnb = await contractAt('FaucetToken', getContractAddress('bnb'), signer)
    const usdt = await contractAt('FaucetToken', getContractAddress('usdt'), signer)
    const usdc = await contractAt('FaucetToken', getContractAddress('usdc'), signer)
    const matic = await contractAt('FaucetToken', getContractAddress('matic'), signer)
    const op = await contractAt('FaucetToken', getContractAddress('op'), signer)
    const arb = await contractAt('FaucetToken', getContractAddress('arb'), signer)

    const rewardRouter = await contractAt('RewardRouter', getContractAddress('rewardRouter'), signer)
    console.log('rewardRouter.address: ', rewardRouter.address)

    await sendTxn(btc.connect(signer).approve(rewardRouter.address, expandDecimals(60, 18)), 'Approve BTC') // BTC Price $26000
    await sendTxn(rewardRouter.mintAndStakeMilp(btc.address, expandDecimals(60, 18), 0, 0), 'Mint and Stake Milp by BTC')

    await sendTxn(bnb.connect(signer).approve(rewardRouter.address, expandDecimals(4800, 18)), 'Approve BNB') // BNB Price $210
    await sendTxn(rewardRouter.mintAndStakeMilp(bnb.address, expandDecimals(4800, 18), 0, 0), 'Mint and Stake Milp by BNB')

    await sendTxn(usdt.connect(signer).approve(rewardRouter.address, expandDecimals(3500000, 18)), 'Approve USDT')
    await sendTxn(rewardRouter.mintAndStakeMilp(usdt.address, expandDecimals(3500000, 18), 0, '0'), 'Mint and Stake Milp by USDT')

    await sendTxn(usdc.connect(signer).approve(rewardRouter.address, expandDecimals(1500000, 18)), 'Approve USDC')
    await sendTxn(rewardRouter.mintAndStakeMilp(usdc.address, expandDecimals(1500000, 18), 0, 0), 'Mint and Stake Milp by USDC')

    await sendTxn(matic.connect(signer).approve(rewardRouter.address, expandDecimals(950000, 18)), 'Approve MATIC') // MATIC Price $0.526
    await sendTxn(rewardRouter.mintAndStakeMilp(matic.address, expandDecimals(950000, 18), 0, 0), 'Mint and Stake Milp by MATIC')

    await sendTxn(op.connect(signer).approve(rewardRouter.address, expandDecimals(406000, 18)), 'Approve OP') // OP Price $1.23
    await sendTxn(rewardRouter.mintAndStakeMilp(op.address, expandDecimals(406000, 18), 0, 0), 'Mint and Stake Milp by OP')

    await sendTxn(arb.connect(signer).approve(rewardRouter.address, expandDecimals(625000, 18)), 'Approve ARB') //ARB Price $0.8
    await sendTxn(rewardRouter.mintAndStakeMilp(arb.address, expandDecimals(625000, 18), 0, 0), 'Mint and Stake Milp by ARB')
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
