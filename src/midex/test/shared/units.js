const { ethers } = require('ethers')

function toUsd(value) {
    const normalizedValue = parseInt(value * Math.pow(10, 10))
    return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(20))
}

toNormalizedPrice = toUsd

function toETH(wei) {
    return ethers.utils.formatEther(wei)
}

function toWei(eth) {
    return ethers.utils.parseUnits(eth.toString(), 'ether')
}

module.exports = {
    toETH,
    toWei,
    toUsd,
    toNormalizedPrice,
}
