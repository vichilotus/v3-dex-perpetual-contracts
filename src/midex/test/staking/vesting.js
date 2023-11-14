const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require('../shared/utilities')
const { toChainLinkPrice } = require('../shared/chainLink')
const { toUsd, toNormalizedPrice } = require('../shared/units')

use(solidity)

const secondsPerYear = 365 * 24 * 60 * 60
const { AddressZero } = ethers.constants
