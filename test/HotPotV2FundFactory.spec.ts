import { BigNumber, constants } from 'ethers'
import { ethers, waffle } from 'hardhat'

import { Fixture } from 'ethereum-waffle'
import completeFixture, { CompleteFixture } from './shared/completeFixture'
import { expect } from './shared/expect'
import { snapshotGasCost } from './shared/utils'
import { computeFundAddress } from './shared/computeFundAddress'


describe('HotPotV2FundFactory', () => {
  const wallets = waffle.provider.getWallets()
  const [wallet, other] = wallets

  let fixture: CompleteFixture;
  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

  const factoryFixture: Fixture<CompleteFixture> = async (wallets, provider) => {
    const fixture = await completeFixture(wallets, provider)
    //setVerifiedToken
    await fixture.controller.setVerifiedToken(fixture.tokens[0].address, true)
    await fixture.controller.setVerifiedToken(fixture.tokens[1].address, true)
    await fixture.controller.setVerifiedToken(fixture.tokens[2].address, true)
    await fixture.controller.setVerifiedToken(fixture.tokens[3].address, false)
    await fixture.controller.setVerifiedToken(fixture.tokens[4].address, false)
    return fixture
  }

  before('create fixture loader', async () => {
    loadFixture = waffle.createFixtureLoader(wallets)
  })

  beforeEach('load fixture', async () => {
    fixture = await loadFixture(factoryFixture);
  })

  it('bytecode size', async () => {
    expect(((await fixture.factory.provider.getCode(fixture.factory.address)).length - 2) / 2).to.matchSnapshot()
  })

  it('constructor initializes', async () => {
    expect(await fixture.factory.WETH9()).to.eq(fixture.weth9.address)
    expect(await fixture.factory.uniV3Factory()).to.eq(fixture.uniV3Factory.address)
    expect(await fixture.factory.uniV3Router()).to.eq(fixture.uniV3Router.address)
    expect(await fixture.factory.controller()).to.eq(fixture.controller.address)
  })

  describe('#createFund', () => {
    const lockPeriod = 15;
    const baseLine = 10;
    const managerFee = 15;

    it('creates the fund at the expected address', async () => {
      const token = fixture.tokens[0]
      const expectedAddress = computeFundAddress(fixture.factory.address, wallet.address, token.address, lockPeriod, baseLine, managerFee, fixture.fundByteCode)
      const code = await wallet.provider.getCode(expectedAddress)
      expect(code).to.eq('0x')

      expect(await fixture.controller.verifiedToken(token.address)).to.eq(true)
      await fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'), lockPeriod, baseLine, managerFee)

      const codeAfter = await wallet.provider.getCode(expectedAddress)
      expect(codeAfter).to.not.eq('0x')
    })

    it('works if token is verified', async () => {
      const token = fixture.tokens[0]

      const fundBefore = await fixture.factory.getFund(wallet.address, token.address)
      expect(fundBefore).to.eq(constants.AddressZero)

      expect(await fixture.controller.verifiedToken(token.address)).to.eq(true)
      const expectedAddress = computeFundAddress(fixture.factory.address, wallet.address, token.address, lockPeriod, baseLine, managerFee, fixture.fundByteCode)
      await expect(fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'), lockPeriod, baseLine, managerFee))
        .to.emit(fixture.factory, 'FundCreated')
        .withArgs(wallet.address, token.address, expectedAddress)

      const fundAfter = await fixture.factory.getFund(wallet.address, token.address)
      expect(fundAfter).to.not.eq(constants.AddressZero)
    })

    it('fails if token is not verified', async () => {
      const token = fixture.tokens[3]

      expect(await fixture.factory.getFund(wallet.address, token.address)).to.eq(constants.AddressZero)
      expect(await fixture.controller.verifiedToken(token.address)).to.eq(false)

      await expect(fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'), lockPeriod, baseLine, managerFee)).to.be.reverted
    })

    it('fails if lockPeriod > 1095 days', async () => {
      const token = fixture.tokens[0]
      await expect(fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'), 1095 * 24 * 3600 + 1, baseLine, managerFee)).to.be.reverted
    })

    it('fails if managerFee > 45', async () => {
      const token = fixture.tokens[0]
      await expect(fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'), lockPeriod, baseLine, 45 + 1)).to.be.reverted
    })

    it('gas', async () => {
      await snapshotGasCost(
        fixture.factory.createFund(fixture.tokens[0].address, ethers.utils.formatBytes32String('abc'), lockPeriod, baseLine, managerFee)
      )
    })
  })
})
