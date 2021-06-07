import { constants } from 'ethers'
import { createFixtureLoader } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { expect } from './shared/expect'
import { expandTo18Decimals } from './shared/utils'
import completeFixture, { CompleteFixture } from './shared/completeFixture'
import { IHotPotV2Fund } from '../typechain/IHotPotV2Fund'
import { computeFundAddress } from './shared/computeFundAddress'
import fundAtAddress from './shared/fundAtAddress'

const TOTAL_SUPPLY = expandTo18Decimals(100 * 1e4);
const TEST_AMOUNT = expandTo18Decimals(10);


describe('HotPotV2FundERC20', () => {
    const {MaxUint256} = constants;
    const wallets = waffle.provider.getWallets();
    const [wallet, other] = wallets;
    const loadFixture = createFixtureLoader([wallet], waffle.provider);

    let fixture: CompleteFixture
    let hotPotFund: IHotPotV2Fund;

    beforeEach(async () => {
        fixture = await loadFixture(completeFixture);
        const token = fixture.tokens[0];

        //setVerifiedToken
        await fixture.controller.setVerifiedToken(fixture.tokens[0].address, true)
        await fixture.controller.setVerifiedToken(fixture.tokens[1].address, true)
        await fixture.controller.setVerifiedToken(fixture.tokens[2].address, true)
        await fixture.controller.setVerifiedToken(fixture.tokens[3].address, false)
        await fixture.controller.setVerifiedToken(fixture.tokens[4].address, false)
        fixture.factory.createFund(token.address, ethers.utils.formatBytes32String('abc'));
        const fundAddress = computeFundAddress(fixture.factory.address, wallet.address, token.address, fixture.fundByteCode)
        hotPotFund = fundAtAddress(fundAddress, wallet);

        await fixture.tokens[0].approve(hotPotFund.address, MaxUint256);
        await hotPotFund.deposit(TOTAL_SUPPLY);
    })

    it('name, symbol, decimals, totalSupply, balanceOf', async () => {
        const name = await hotPotFund.name();
        expect(name).to.eq('Hotpot V2');
        expect(await hotPotFund.symbol()).to.eq('HPT-V2');
        expect(await hotPotFund.decimals()).to.eq(18);
        expect(await hotPotFund.totalSupply()).to.eq(TOTAL_SUPPLY);
        expect(await hotPotFund.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY);
    });

    it('approve', async () => {
        //wallet approve to other amount = TEST_AMOUNT
        await expect(hotPotFund.approve(other.address, TEST_AMOUNT))
            .to.emit(hotPotFund, 'Approval')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //other allowance = TEST_AMOUNT
        expect(await hotPotFund.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT);
    });

    it('transfer', async () => {
        //wallet transfer to other amount = TEST_AMOUNT
        await expect(hotPotFund.transfer(other.address, TEST_AMOUNT))
            .to.emit(hotPotFund, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //wallet balanceOf=TOTAL_SUPPLY-TEST_AMOUNT
        expect(await hotPotFund.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));

        //other balanceOf=TEST_AMOUNT
        expect(await hotPotFund.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it('transfer:fail', async () => {
        //transfer amount > balance
        await expect(hotPotFund.transfer(other.address, TOTAL_SUPPLY.add(1))).to.be.reverted;

        //transfer amount > balance
        await expect(hotPotFund.connect(other).transfer(wallet.address, 1)).to.be.reverted;

        //self transfer amount > balance
        await expect(hotPotFund.connect(other).transfer(other.address, 1)).to.be.reverted;
    });

    it('transferFrom', async () => {
        //approve TEST_AMOUNT
        await hotPotFund.approve(other.address, TEST_AMOUNT);

        //transferFrom TEST_AMOUNT
        await expect(hotPotFund.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(hotPotFund, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //allowance = 0
        expect(await hotPotFund.allowance(wallet.address, other.address)).to.eq(0);
        //sender balanceOf = TOTAL_SUPPLY - TEST_AMOUNT
        expect(await hotPotFund.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        //receiver balanceOf = TEST_AMOUNT
        expect(await hotPotFund.balanceOf(other.address)).to.eq(TEST_AMOUNT);
    });

    it('transferFrom:max', async () => {
        //approve max
        await hotPotFund.approve(other.address, MaxUint256);

        //transferFrom TEST_AMOUNT
        await expect(hotPotFund.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
            .to.emit(hotPotFund, 'Transfer')
            .withArgs(wallet.address, other.address, TEST_AMOUNT);

        //allowance = max - TEST_AMOUNT
        expect(await hotPotFund.allowance(wallet.address, other.address)).to.eq(MaxUint256.sub(TEST_AMOUNT));
        //sender balanceOf = TOTAL_SUPPLY - TEST_AMOUNT
        expect(await hotPotFund.balanceOf(wallet.address)).to.eq(TOTAL_SUPPLY.sub(TEST_AMOUNT));
        //receiver balanceOf = TEST_AMOUNT
        expect(await hotPotFund.balanceOf(other.address)).to.eq(TEST_AMOUNT)
    });
});
