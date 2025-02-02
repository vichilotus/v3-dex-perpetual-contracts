const BN = require('bn.js')
const { ethers } = require('ethers')
const fetch = require('node-fetch')

const maxUint256 = ethers.constants.MaxUint256

function newWallet() {
    return ethers.Wallet.createRandom()
}

function bigNumberify(n) {
    return ethers.BigNumber.from(n)
}

function expandDecimals(n, decimals) {
    return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

async function send(provider, method, params = []) {
    await provider.send(method, params)
}

async function mineBlock(provider) {
    await send(provider, 'evm_mine')
}

async function increaseTime(provider, seconds) {
    await send(provider, 'evm_increaseTime', [seconds])
}

async function increaseBlockTime(provider, seconds) {
    await send(provider, 'evm_increaseTime', [seconds])
    await send(provider, 'evm_mine')
}

async function gasUsed(provider, tx) {
    return (await provider.getTransactionReceipt(tx.hash)).gasUsed
}

async function getNetworkFee(provider, tx) {
    const gas = await gasUsed(provider, tx)
    return gas.mul(tx.gasPrice)
}

async function reportGasUsed(provider, tx, label) {
    const { gasUsed } = await provider.getTransactionReceipt(tx.hash)
    console.info(label, gasUsed.toString())
}

async function getBlockTime(provider) {
    const blockNumber = await provider.getBlockNumber()
    const block = await provider.getBlock(blockNumber)
    return block.timestamp
}

async function getTxnBalances(provider, user, txn, callback) {
    const balance0 = await provider.getBalance(user.address)
    const tx = await txn()
    const fee = await getNetworkFee(provider, tx)
    const balance1 = await provider.getBalance(user.address)
    callback(balance0, balance1, fee)
}

function print(label, value, decimals) {
    if (decimals === 0) {
        console.log(label, value.toString())
        return
    }
    const valueStr = ethers.utils.formatUnits(value, decimals)
    console.log(label, valueStr)
}

function getPriceBitArray(prices) {
    let priceBitArray = []
    let shouldExit = false

    for (let i = 0; i < parseInt((prices.length - 1) / 8) + 1; i++) {
        let priceBits = new BN('0')
        for (let j = 0; j < 8; j++) {
            let index = i * 8 + j
            if (index >= prices.length) {
                shouldExit = true
                break
            }

            const price = new BN(prices[index])
            if (price.gt(new BN('2147483648'))) {
                // 2^31
                throw new Error(`price exceeds bit limit ${price.toString()}`)
            }
            priceBits = priceBits.or(price.shln(j * 32))
        }

        priceBitArray.push(priceBits.toString())

        if (shouldExit) {
            break
        }
    }

    return priceBitArray
}

function getTimestamp() {
    return Math.floor(new Date().getTime() / 1000)
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function getURL(url) {
    return fetch(url).then((res) => res.text())
}

async function getJSONRequest(url) {
    return JSON.parse(await getURL(url))
}

function getProvider(rpc) {
    return new ethers.providers.JsonRpcProvider(rpc)
}

function getWeb3(rpc) {
    return new Web3(rpc)
}

function getSigner(privateKey, rpc) {
    const provider = getProvider(rpc)
    const signer = new ethers.Wallet(privateKey, provider)
    return signer
}

function getPriceBits(prices) {
    if (prices.length > 8) {
        throw new Error('max prices.length exceeded')
    }

    let priceBits = new BN('0')

    for (let j = 0; j < 8; j++) {
        let index = j
        if (index >= prices.length) {
            break
        }

        const price = new BN(prices[index])
        if (price.gt(new BN('2147483648'))) {
            // 2^31
            throw new Error(`price exceeds bit limit ${price.toString()}`)
        }

        priceBits = priceBits.or(price.shln(j * 32))
    }

    return priceBits.toString()
}

module.exports = {
    bigNumberify,
    expandDecimals,
    gasUsed,
    getBlockTime,
    getJSONRequest,
    getNetworkFee,
    getPriceBitArray,
    getPriceBits,
    getProvider,
    getSigner,
    getTimestamp,
    getTxnBalances,
    getWeb3,
    increaseBlockTime,
    increaseTime,
    maxUint256,
    mineBlock,
    newWallet,
    print,
    reportGasUsed,
    sleep,
}
