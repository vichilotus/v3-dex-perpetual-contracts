function toChainLinkPrice(value) {
    return parseInt(value * Math.pow(10, 8))
}

function toMiOraclePrice(value) {
    return parseInt(value * Math.pow(10, 8))
}

module.exports = { toChainLinkPrice, toMiOraclePrice }
