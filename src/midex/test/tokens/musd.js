const { expect, use } = require('chai')
const { solidity } = require('ethereum-waffle')
const { deployContract } = require('../shared/fixtures')
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require('../shared/utilities')

use(solidity)

describe('MUSD', function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()
    let musd

    beforeEach(async () => {
        musd = await deployContract('MUSD', [user1.address])
    })

    it('addVault', async () => {
        await expect(musd.connect(user0).addVault(user0.address)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        await musd.transferGovernance(user0.address)
        await musd.connect(user0).acceptGovernance()
        expect(await musd.vaults(user0.address)).eq(false)
        await musd.connect(user0).addVault(user0.address)
        expect(await musd.vaults(user0.address)).eq(true)
    })

    it('removeVault', async () => {
        await expect(musd.connect(user0).removeVault(user0.address)).to.be.revertedWith(`GovernableUnauthorizedAccount("${user0.address}")`)

        await musd.transferGovernance(user0.address)
        await musd.connect(user0).acceptGovernance()
        expect(await musd.vaults(user0.address)).eq(false)
        await musd.connect(user0).addVault(user0.address)
        expect(await musd.vaults(user0.address)).eq(true)
        await musd.connect(user0).removeVault(user0.address)
        expect(await musd.vaults(user0.address)).eq(false)
    })

    it('mint', async () => {
        expect(await musd.balanceOf(user1.address)).eq(0)
        await musd.connect(user1).mint(user1.address, 1000)
        expect(await musd.balanceOf(user1.address)).eq(1000)
        expect(await musd.totalSupply()).eq(1000)

        await expect(musd.connect(user0).mint(user1.address, 1000)).to.be.revertedWith('MUSD: forbidden')

        await musd.addVault(user0.address)

        expect(await musd.balanceOf(user1.address)).eq(1000)
        await musd.connect(user0).mint(user1.address, 500)
        expect(await musd.balanceOf(user1.address)).eq(1500)
        expect(await musd.totalSupply()).eq(1500)
    })

    it('burn', async () => {
        expect(await musd.balanceOf(user1.address)).eq(0)
        await musd.connect(user1).mint(user1.address, 1000)
        expect(await musd.balanceOf(user1.address)).eq(1000)
        await musd.connect(user1).burn(user1.address, 300)
        expect(await musd.balanceOf(user1.address)).eq(700)
        expect(await musd.totalSupply()).eq(700)

        await expect(musd.connect(user0).burn(user1.address, 100)).to.be.revertedWith('MUSD: forbidden')

        await musd.addVault(user0.address)

        await musd.connect(user0).burn(user1.address, 100)
        expect(await musd.balanceOf(user1.address)).eq(600)
        expect(await musd.totalSupply()).eq(600)
    })
})
