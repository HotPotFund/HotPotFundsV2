import { BigNumber, constants, Contract } from 'ethers'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { expect } from './shared/expect'
import {
    encodePriceSqrt,
    expandTo18Decimals,
    expandTo6Decimals,
    getPositionKey,
    snapshotGasCost,
    sortedTokens
} from './shared/utils'
import { INIT_FOR_TEST_WETH_AMOUNT, mintAndDepositHotPotFund, readStatus } from './shared/fixtures'
import completeFixture, { CompleteFixture } from './shared/completeFixture'
import { createFund, createUniV3PoolAndInit } from './shared/createUtils'
import { encodePath } from './shared/path'
import { FeeAmount, TICK_SPACINGS } from './shared/constants'
import { IHotPotV2Fund } from '../typechain'
import { getMaxTick, getMinTick } from './shared/ticks'
import { computePoolAddress } from './shared/computePoolAddress'
import { IUniswapV3Pool } from '../typechain/IUniswapV3Pool'
import poolAtAddress from './shared/poolAtAddress'
import { calExpectedWithdrawAmount, getExpectedAssetsOfPosition } from './shared/calExpecteds'
import { ISwapRouter } from '../typechain/ISwapRouter'

const initDepositAmount = 1e1;
const INIT_DEPOSIT_AMOUNT_18 = expandTo18Decimals(initDepositAmount);
const INIT_DEPOSIT_AMOUNT_6 = expandTo6Decimals(initDepositAmount);
const IS_SHOW_LOG = false;

const overrides = {
    gasLimit: 9999999
}

describe('HotPotV2Fund', () => {
    const wallets = waffle.provider.getWallets()
    const [manager, depositor, trader, other, depositor2] = wallets;
    const governance = other;

    let fixture: CompleteFixture;
    let loadFixture: ReturnType<typeof waffle.createFixtureLoader>

    let hotPotFund: IHotPotV2Fund;
    let descriptor = "abc";
    let investToken: Contract;
    let token0: Contract;
    let token1: Contract;
    let token2: Contract;
    let fundT0Pool: IUniswapV3Pool;
    let fundT1Pool: IUniswapV3Pool;
    let t0T1Pool: IUniswapV3Pool;

    let INIT_DEPOSIT_AMOUNT: BigNumber;

    const hotPotFundFixture: Fixture<CompleteFixture> = async (wallets, provider) => {
        const fixture = await completeFixture(wallets, provider, governance)
        //transfer tokens to tester
        for (const token of fixture.tokens) {
            const amount = await token.decimals() == 18 ? INIT_DEPOSIT_AMOUNT_18 : INIT_DEPOSIT_AMOUNT_6;
            await token.connect(manager).transfer(depositor.address, amount.mul(100))
            await token.connect(manager).transfer(depositor2.address, amount.mul(100))
            await token.connect(manager).transfer(trader.address, amount.mul(100))
            await token.connect(trader).approve(fixture.uniV3Router.address, constants.MaxUint256)
        }
        await fixture.weth9.connect(manager).deposit({...overrides, value: INIT_FOR_TEST_WETH_AMOUNT})
        await fixture.weth9.connect(depositor).deposit({...overrides, value: INIT_FOR_TEST_WETH_AMOUNT})
        await fixture.weth9.connect(depositor2).deposit({...overrides, value: INIT_FOR_TEST_WETH_AMOUNT})
        await fixture.weth9.connect(trader).deposit({...overrides, value: INIT_FOR_TEST_WETH_AMOUNT})
        await fixture.weth9.connect(trader).approve(fixture.uniV3Router.address, constants.MaxUint256)

        //setVerifiedToken
        await fixture.controller.connect(governance).setVerifiedToken(fixture.weth9.address, true);
        for (const token of fixture.tokens) {
            await fixture.controller.connect(governance).setVerifiedToken(token.address, true);
        }

        fixture.tokens.unshift(fixture.weth9) //eth fund
        investToken = fixture.tokens.shift() as Contract;
        fixture.tokens = fixture.tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
        token0 = fixture.tokens[0];
        token1 = fixture.tokens[1];
        token2 = fixture.tokens[2];

        INIT_DEPOSIT_AMOUNT = await investToken.decimals() == 18 ? INIT_DEPOSIT_AMOUNT_18 : INIT_DEPOSIT_AMOUNT_6;

        //investToken+t0 pool
        fundT0Pool = await createUniV3PoolAndInit(manager, fixture, investToken, token0);
        //investToken+t1 pool
        fundT1Pool = await createUniV3PoolAndInit(manager, fixture, investToken, token1);
        //t0+t1 pool
        t0T1Pool = await createUniV3PoolAndInit(manager, fixture, token0, token1);
        //investToken+t2 pool
        fundT1Pool = await createUniV3PoolAndInit(manager, fixture, investToken, token2);

        //create a fund
        hotPotFund = await createFund(manager, investToken, descriptor, fixture.factory);

        return fixture
    }

    before(async () => {
        loadFixture = await waffle.createFixtureLoader(wallets)
    });

    beforeEach(async () => {
        fixture = await loadFixture(hotPotFundFixture);
    });

    it('bytecode size', async () => {
        expect(((await hotPotFund.provider.getCode(hotPotFund.address)).length - 2) / 2).to.matchSnapshot()
    })

    it('constructor initializes', readStatus(() => {
            const target = hotPotFund;
            const caseData = {
                controller: {
                    value: fixture.controller.address
                },
                manager: {
                    value: manager.address
                },
                token: {
                    value: investToken.address
                },
                descriptor:{
                    value: ethers.utils.formatBytes32String(descriptor)
                },
                totalInvestment: {
                    value: 0
                },
                totalAssets:{
                    value: 0
                },
                poolsLength:{
                    value: 0
                },
                // pools: {
                //     symbol: "shallowDeepEqual",
                //     args: [0],
                //     value: constants.AddressZero
                // },
                // positionsLength:{
                //     args: [0],
                //     value: 0
                // },
            };
            return {target, caseData};
        }
    ));

    describe('#setPath', ()=>{
        it("1 fail if it's not a action called by controller", async () => {
            //path for token0
            await expect(hotPotFund.connect(manager).setPath(
              token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM])
            )).to.be.reverted;
        });

        it("works", async () => {
            await showAssetStatus("init status：");
            //path for token0
            const buyPath = encodePath([investToken.address, token1.address, token0.address], [FeeAmount.MEDIUM,FeeAmount.MEDIUM])
            const sellPath = encodePath([token0.address, token1.address, investToken.address], [FeeAmount.MEDIUM,FeeAmount.MEDIUM])
            let tx = fixture.controller.connect(manager).setPath(
              hotPotFund.address,
              token0.address,
              buyPath
            );
            await expect(tx).to.not.be.reverted;
            await snapshotGasCost(tx);//gas
            await showAssetStatus("setPath：");
            expect(await hotPotFund.buyPath(token0.address)).to.eq(buyPath);
            expect(await hotPotFund.sellPath(token0.address)).to.eq(sellPath);
        });

        describe("reSet sellPath", ()=>{
            beforeEach("init pool assets", async()=>{
                //path for token0
                await setPaths(
                  token0.address,
                  encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
                  encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
                //path for token1
                await setPaths(
                  token1.address,
                  encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
                  encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))
                //deposit investToken
                await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);
                // init positions[0][0]: t0+t1
                await expect(fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  token0.address, token1.address, FeeAmount.MEDIUM,
                  getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  INIT_DEPOSIT_AMOUNT,
                  Math.round(new Date().getTime() / 1e3 + 12000)
                )).to.not.be.reverted
            })

            it('fail if pool asset is not zero', async () => {
                // reset sellPath fail
                await expect(fixture.controller.connect(manager).setPath(
                  hotPotFund.address, token0.address, encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM])
                )).to.be.revertedWith("AZ");
            })

            it('work if pool asset is zero', async () => {
                //clear pool
                await expect(fixture.controller.connect(manager).sub(
                  hotPotFund.address,
                  0, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
                  Math.round(new Date().getTime() / 1e3 + 12000),
                  overrides
                )).to.not.be.reverted

                // reset sellPath ok
                await expect(fixture.controller.connect(manager).setPath(
                  hotPotFund.address, token0.address, encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM])
                )).to.not.be.reverted;
            })
        })
    })

    async function setPaths(token:string, buyPath:string, sellPath:string){
        await expect(fixture.controller.connect(manager).setPath(
          hotPotFund.address, token, buyPath
        )).to.not.be.reverted;
        expect(await hotPotFund.buyPath(token)).to.eq(buyPath);
        expect(await hotPotFund.sellPath(token)).to.eq(sellPath);
    }

    describe('#deposit', () => {
        it("1 fails when amount==0", async () => {
            await investToken.connect(depositor).approve(hotPotFund.address, constants.MaxUint256);
            await expect(hotPotFund.connect(depositor).deposit(
              0
            )).to.be.reverted;
        });

        it("2 fails when allowance==0", async () => {
            await investToken.connect(depositor).approve(hotPotFund.address, 0);
            await expect(hotPotFund.connect(depositor).deposit(
              INIT_DEPOSIT_AMOUNT
            )).to.be.reverted;
        });

        it("is payable ETH if fund token is WET9", async () =>{
            if(investToken.address == fixture.weth9.address){
                await depositor.sendTransaction({
                    to:hotPotFund.address,
                    value:INIT_DEPOSIT_AMOUNT
                });
                expect(await hotPotFund.totalInvestment()).to.eq(INIT_DEPOSIT_AMOUNT)
                expect(await hotPotFund.investmentOf(depositor.address)).to.eq(INIT_DEPOSIT_AMOUNT)
                expect(await hotPotFund.balanceOf(depositor.address)).to.eq(INIT_DEPOSIT_AMOUNT)
                expect(await hotPotFund.totalSupply()).to.eq(INIT_DEPOSIT_AMOUNT)
                expect(await hotPotFund.totalAssets()).to.eq(INIT_DEPOSIT_AMOUNT)
            }
        })

        it('works', async () => {
            await showAssetStatus("init status：");
            //init status
            let investment = await hotPotFund.investmentOf(depositor.address);
            let totalInvestment = await hotPotFund.totalInvestment();
            let balance = await hotPotFund.balanceOf(depositor.address)
            let totalSupply = await hotPotFund.totalSupply();
            let totalAssets = await hotPotFund.totalAssets();

            let addAmount = INIT_DEPOSIT_AMOUNT.div(2)
            let addShare = addAmount
            investment = investment.add(addAmount);
            totalInvestment = totalInvestment.add(addAmount);
            balance = balance.add(addShare)
            totalSupply = totalSupply.add(addShare);
            totalAssets = totalAssets.add(addAmount);

            //first deposit
            await investToken.connect(depositor).approve(hotPotFund.address, constants.MaxUint256)
            let tx = hotPotFund.connect(depositor).deposit(addAmount);
            await expect(tx)
              .to.emit(hotPotFund, 'Deposit')
              .withArgs(depositor.address, addAmount, addShare)
            await snapshotGasCost(tx);
            await showAssetStatus("first deposit：");
            expect(await hotPotFund.totalInvestment()).to.eq(totalInvestment)
            expect(await hotPotFund.investmentOf(depositor.address)).to.eq(investment)
            expect(await hotPotFund.balanceOf(depositor.address)).to.eq(balance)
            expect(await hotPotFund.totalSupply()).to.eq(totalSupply)
            expect(await hotPotFund.totalAssets()).to.eq(totalAssets)

            addAmount = INIT_DEPOSIT_AMOUNT.sub(addAmount)
            addShare = addAmount;
            investment = investment.add(addAmount);
            totalInvestment = totalInvestment.add(addAmount);
            balance = balance.add(addShare)
            totalSupply = totalSupply.add(addShare);
            totalAssets = totalAssets.add(addAmount);

            //second deposit
            tx = hotPotFund.connect(depositor).deposit(addAmount);
            await expect(tx)
              .to.emit(hotPotFund, 'Deposit')
              .withArgs(depositor.address, addAmount, addShare)
            await snapshotGasCost(tx);
            await showAssetStatus("second deposit：");
            expect(await hotPotFund.totalInvestment()).to.eq(totalInvestment)
            expect(await hotPotFund.investmentOf(depositor.address)).to.eq(investment)
            expect(await hotPotFund.balanceOf(depositor.address)).to.eq(balance)
            expect(await hotPotFund.totalSupply()).to.eq(totalSupply)
            expect(await hotPotFund.totalAssets()).to.eq(totalAssets)

            addAmount = INIT_DEPOSIT_AMOUNT;
            addShare = addAmount;
            investment = addAmount;
            totalInvestment = totalInvestment.add(addAmount);
            balance = addShare
            totalSupply = totalSupply.add(addShare);
            totalAssets = totalAssets.add(addAmount);

            //other depositor
            await investToken.connect(depositor2).approve(hotPotFund.address, constants.MaxUint256)
            tx = hotPotFund.connect(depositor2).deposit(addAmount);
            await expect(tx)
              .to.emit(hotPotFund, 'Deposit')
              .withArgs(depositor2.address, addAmount, addShare)
            await snapshotGasCost(tx);
            await showAssetStatus("other deposit：");
            expect(await hotPotFund.totalInvestment()).to.eq(totalInvestment)
            expect(await hotPotFund.investmentOf(depositor2.address)).to.eq(investment)
            expect(await hotPotFund.balanceOf(depositor2.address)).to.eq(balance)
            expect(await hotPotFund.totalSupply()).to.eq(totalSupply)
            expect(await hotPotFund.totalAssets()).to.eq(totalAssets)
        })
    })

    describe('#init', () => {
        beforeEach("setPath", async()=>{
            //path for token0
            await setPaths(
              token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
            //path for token1
            await setPaths(
              token1.address,
              encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
              encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))
            //deposit investToken
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);
        })

        it("1.1 fails if action isn't called by controller", async () => {
            await expect(hotPotFund.connect(manager).init(
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              await fixture.controller.maxSqrtSlippage()
            )).to.be.reverted
        });

        it("1.2 works if amount==0" ,async()=>{
            const tickLower = getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
            const tickUpper = getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
            const tx = fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              tickLower, tickUpper,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000));
            await expect(tx).to.not.be.reverted;
            await snapshotGasCost(tx);

            expect(await hotPotFund.poolsLength()).to.eq(1);
            expect(await hotPotFund.positionsLength(0)).to.eq(1);
            expect(await hotPotFund.pools(0)).to.eq(computePoolAddress(fixture.uniV3Factory.address,
              [token0.address, token1.address], FeeAmount.MEDIUM));
            const position = await hotPotFund.positions(0, 0)
            expect(position.isEmpty).to.eq(true);
            expect(position.tickLower).to.eq(tickLower);
            expect(position.tickUpper).to.eq(tickUpper);
        })

        it("2 fail if pool is invalid", async () => {
            const tokens = sortedTokens(token1, token2);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted
        });

        it("3 fail if ticks/tokens order error", async () => {
            //tokens order error
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token1.address, token0.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted
            //ticks order error
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted
        });

        it("4 works if amount>0", async () => {
            const tickLower = getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
            const tickUpper = getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
            // 1th positions[0][0]
            const tx = fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              tickLower, tickUpper, INIT_DEPOSIT_AMOUNT,
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);

            expect(await hotPotFund.poolsLength()).to.eq(1);
            expect(await hotPotFund.positionsLength(0)).to.eq(1);
            expect(await hotPotFund.pools(0)).to.eq(computePoolAddress(fixture.uniV3Factory.address,
              [token0.address, token1.address], FeeAmount.MEDIUM));
            const position = await hotPotFund.positions(0, 0)
            expect(position.isEmpty).to.eq(false);
            expect(position.tickLower).to.eq(tickLower);
            expect(position.tickUpper).to.eq(tickUpper);
        });

        describe("5 init multiple position", () => {
            beforeEach("init 1th position of 1th pool and amount>0", async ()=>{
                // t0+t1 position
                await expect(fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  token0.address, token1.address, FeeAmount.MEDIUM,
                  getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  INIT_DEPOSIT_AMOUNT.div(2),
                  Math.round(new Date().getTime() / 1e3 + 12000),
                  overrides
                )).to.not.be.reverted
            })

            it("5.1 fails if init the same position repeatedly", async () => {
                // t0+t1 position
                await expect(fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  token0.address, token1.address, FeeAmount.MEDIUM,
                  getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  INIT_DEPOSIT_AMOUNT.div(2),
                  Math.round(new Date().getTime() / 1e3 + 12000),
                  overrides
                )).to.be.reverted
            });

            it("5.2 init 2th position of 1th pool and amount>0", async ()=>{
                const tickLower = getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]) + TICK_SPACINGS[FeeAmount.MEDIUM] * 10;
                const tickUpper = getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]) - TICK_SPACINGS[FeeAmount.MEDIUM] * 10;
                let tx = fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  token0.address, token1.address, FeeAmount.MEDIUM,
                  tickLower, tickUpper, INIT_DEPOSIT_AMOUNT.div(2),
                  Math.round(new Date().getTime() / 1e3 + 12000)
                );
                await expect(tx).to.not.be.reverted
                await snapshotGasCost(tx);

                expect(await hotPotFund.poolsLength()).to.eq(1);
                expect(await hotPotFund.positionsLength(0)).to.eq(2);
                expect(await hotPotFund.pools(0)).to.eq(computePoolAddress(fixture.uniV3Factory.address,
                  [token0.address, token1.address], FeeAmount.MEDIUM));
                const position = await hotPotFund.positions(0, 1)
                expect(position.isEmpty).to.eq(false);
                expect(position.tickLower).to.eq(tickLower);
                expect(position.tickUpper).to.eq(tickUpper);
            })

            it("5.3 init more position and amount>0", async ()=>{
                await showAssetStatus("init status：");
                const tickLower = getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
                const tickUpper = getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]);
                //init positions[1][0]: fund+t0
                let tokens = sortedTokens(investToken, token0);
                let tx = fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
                  tickLower, tickUpper, 0,
                  Math.round(new Date().getTime() / 1e3 + 12000)
                );
                await expect(tx).to.not.be.reverted
                await snapshotGasCost(tx);
                await showAssetStatus("init [1][0]：");
                expect(await hotPotFund.poolsLength()).to.eq(2);
                expect(await hotPotFund.positionsLength(1)).to.eq(1);
                expect(await hotPotFund.pools(1)).to.eq(computePoolAddress(fixture.uniV3Factory.address,
                  [investToken.address, token0.address], FeeAmount.MEDIUM));
                let position = await hotPotFund.positions(1, 0)
                expect(position.isEmpty).to.eq(true);
                expect(position.tickLower).to.eq(tickLower);
                expect(position.tickUpper).to.eq(tickUpper);

                //init positions[2][0]: fund+t1 position
                tokens = sortedTokens(investToken, token1);
                tx = fixture.controller.connect(manager).init(
                  hotPotFund.address,
                  tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
                  getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
                  INIT_DEPOSIT_AMOUNT.div(2),
                  Math.round(new Date().getTime() / 1e3 + 12000)
                );
                await expect(tx).to.not.be.reverted
                await snapshotGasCost(tx);
                await showAssetStatus("init [2][0]：");
                expect(await hotPotFund.poolsLength()).to.eq(3);
                expect(await hotPotFund.positionsLength(2)).to.eq(1);
                expect(await hotPotFund.pools(2)).to.eq(computePoolAddress(fixture.uniV3Factory.address,
                  [investToken.address, token1.address], FeeAmount.MEDIUM));
                position = await hotPotFund.positions(2, 0)
                expect(position.isEmpty).to.eq(false);
                expect(position.tickLower).to.eq(tickLower);
                expect(position.tickUpper).to.eq(tickUpper);
            })
        })
    })

    describe("#add", async ()=>{
        beforeEach("set path and init position", async()=>{
            //path for token0
            await setPaths(
              token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
            //path for token1
            await setPaths(
              token1.address,
              encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
              encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))

            //deposit investToken
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);

            // init positions[0][0]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[0][1]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM])+TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM])-TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[1][0]: fund+t0
            let tokens = sortedTokens(investToken, token0);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[2][0]: fund+t1
            tokens = sortedTokens(investToken, token1);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            expect(await hotPotFund.poolsLength()).to.eq(3);
            expect(await hotPotFund.positionsLength(0)).to.eq(2);
            expect(await hotPotFund.positionsLength(1)).to.eq(1);
            expect(await hotPotFund.positionsLength(2)).to.eq(1);
        })

        it("1.1 fails if action isn't called by controller", async () => {
            await expect(hotPotFund.connect(manager).add(
              0, 0, INIT_DEPOSIT_AMOUNT, true,
              await fixture.controller.maxSqrtSlippage(),
              overrides
            )).to.be.reverted

            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 0, INIT_DEPOSIT_AMOUNT, true,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.not.be.reverted
        });

        it("2 fails if index is invalid", async()=>{
            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              3, 0, INIT_DEPOSIT_AMOUNT, true,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 2, INIT_DEPOSIT_AMOUNT, true,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
        })

        it("3 fails if balance < amount or amount==0", async()=>{
            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 0, INIT_DEPOSIT_AMOUNT.add(BigNumber.from(1)), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
            //amount==0
            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 0, 0, false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
            //fee==0
            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 0, 0, true,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
        })

        it('fail if the price impact is too big', async() => {
            await expect(fixture.controller.connect(governance).setMaxPriceImpact(10))
              .to.emit(fixture.controller, "SetMaxPriceImpact").withArgs(10);

            await expect(fixture.controller.connect(manager).add(
              hotPotFund.address,
              1, 0, INIT_DEPOSIT_AMOUNT, false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.revertedWith("Too little received")
        });

        it("works", async() => {
            await showAssetStatus("init status：");
            let tx = fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 0, INIT_DEPOSIT_AMOUNT.div(4), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("add [0][0] 1/4：");
            let funds = await showAddLavePercent(INIT_DEPOSIT_AMOUNT.div(4), INIT_DEPOSIT_AMOUNT);

            tx = fixture.controller.connect(manager).add(
              hotPotFund.address,
              0, 1, INIT_DEPOSIT_AMOUNT.div(4), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("add [0][1] 1/4：");
            funds = await showAddLavePercent(INIT_DEPOSIT_AMOUNT.div(4), funds);

            tx = fixture.controller.connect(manager).add(
              hotPotFund.address,
              1, 0, INIT_DEPOSIT_AMOUNT.div(4), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("add [1][0] 1/4：");
            funds = await showAddLavePercent(INIT_DEPOSIT_AMOUNT.div(4), funds);

            tx = fixture.controller.connect(manager).add(
              hotPotFund.address,
              2, 0, INIT_DEPOSIT_AMOUNT.div(4), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("add [2][0] 1/4：");
            funds = await showAddLavePercent(INIT_DEPOSIT_AMOUNT.div(4), funds);
        })
    })

    describe("#sub", ()=>{
        beforeEach("set path and init position", async()=>{
            //path for token0
            await setPaths(
              token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
            //path for token1
            await setPaths(
              token1.address,
              encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
              encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))

            //deposit investToken
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);

            // init positions[0][0]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[0][1]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]) + TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]) - TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[1][0]: fund+t0
            let tokens = sortedTokens(investToken, token0);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[2][0]: fund+t1
            tokens = sortedTokens(investToken, token1);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            expect(await hotPotFund.poolsLength()).to.eq(3);
            expect(await hotPotFund.positionsLength(0)).to.eq(2);
            expect(await hotPotFund.positionsLength(1)).to.eq(1);
            expect(await hotPotFund.positionsLength(2)).to.eq(1);
        })

        it("1.1 fails if action isn't called by controller", async () => {
            await expect(hotPotFund.connect(manager).sub(
              0, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              await fixture.controller.maxSqrtSlippage(),
              overrides
            )).to.be.reverted

            await expect(fixture.controller.connect(manager).sub(
              hotPotFund.address,
              0, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.not.be.reverted
        });

        it("2 fails if index is invalid", async()=>{
            //invalid pool index
            await expect(fixture.controller.connect(manager).sub(
              hotPotFund.address,
              3, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
            //invalid position index
            await expect(fixture.controller.connect(manager).sub(
              hotPotFund.address,
              0, 2, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
        })

        it("3 fails if proportionX128 > 100", async()=>{
            await expect(fixture.controller.connect(manager).sub(
              hotPotFund.address,
              0, 0, BigNumber.from(101).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.be.reverted
        })

        it("works", async() => {
            await showAssetStatus("init status：");
            let tx = fixture.controller.connect(manager).sub(
              hotPotFund.address,
              0, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("sub [0][0] 100%：");
            let position = await hotPotFund.positions(0, 0)
            expect(position.isEmpty).to.eq(true);

            tx = fixture.controller.connect(manager).sub(
              hotPotFund.address,
              0, 1, BigNumber.from(50).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("sub [0][1] 50%：");
            position = await hotPotFund.positions(0, 1)
            expect(position.isEmpty).to.eq(false);

            tx = fixture.controller.connect(manager).sub(
              hotPotFund.address,
              1, 0, BigNumber.from(50).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("sub [1][0] 50%：");
            position = await hotPotFund.positions(1, 0)
            expect(position.isEmpty).to.eq(false);

            tx = fixture.controller.connect(manager).sub(
              hotPotFund.address,
              1, 0, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("sub [1][0] 100%：");
            position = await hotPotFund.positions(1, 0)
            expect(position.isEmpty).to.eq(true);
        })
    })

    describe("#move", ()=>{
        beforeEach("set path and init position", async()=>{
            //path for token0
            await setPaths(token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
            //path for token1
            await setPaths(token1.address,
              encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
              encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))

            //deposit investToken
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);

            // init positions[0][0]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[0][1]: t0+t1
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]) + TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]) - TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted

            // init positions[1][0]: fund+t0
            let tokens = sortedTokens(investToken, token0);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[1][1]: fund+t0
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]) + TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]) - TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              INIT_DEPOSIT_AMOUNT.div(4),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            expect(await hotPotFund.poolsLength()).to.eq(2);
            expect(await hotPotFund.positionsLength(0)).to.eq(2);
            expect(await hotPotFund.positionsLength(1)).to.eq(2);
        })

        it("1.1 fails if action isn't called by controller", async () => {
            await expect(hotPotFund.connect(manager).move(
              0, 0, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              await fixture.controller.maxSqrtSlippage(),
            )).to.be.reverted

            await expect(fixture.controller.connect(manager).move(
              hotPotFund.address,
              0, 0, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.not.be.reverted
        });

        it("2 fails if index is invalid", async()=>{
            //invalid pool index
            await expect(fixture.controller.connect(manager).move(
              hotPotFund.address,
              3, 0, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted

            //invalid subIndex
            await expect(fixture.controller.connect(manager).move(
              hotPotFund.address,
              0, 2, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted

            //invalid addIndex
            await expect(fixture.controller.connect(manager).move(
              hotPotFund.address,
              0, 0, 2, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted
        })

        it("3 fails if proportionX128 > 100", async()=>{
            await expect(fixture.controller.connect(manager).move(
              hotPotFund.address,
              0, 0, 1, BigNumber.from(101).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.be.reverted
        })

        it("works", async() => {
            await showAssetStatus("init status：");
            //move 100% [0][0] to [0][1]
            let tx = fixture.controller.connect(manager).move(
              hotPotFund.address,
              0, 0, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("move 100% [0][0] to [0][1]");
            expect((await hotPotFund.positions(0, 0)).isEmpty).to.eq(true);
            expect((await hotPotFund.positions(0, 1)).isEmpty).to.eq(false);

            //move 50% [1][0] to [1][1]
            tx = fixture.controller.connect(manager).move(
              hotPotFund.address,
              1, 0, 1, BigNumber.from(50).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("move 50% [1][0] to [1][1]：");
            expect((await hotPotFund.positions(1, 0)).isEmpty).to.eq(false);
            expect((await hotPotFund.positions(1, 1)).isEmpty).to.eq(false);

            //move 100% [1][0] to [1][1]
            tx = fixture.controller.connect(manager).move(
              hotPotFund.address,
              1, 0, 1, BigNumber.from(100).mul(BigNumber.from(2).pow(128)),
              Math.round(new Date().getTime() / 1e3 + 12000)
            );
            await expect(tx).to.not.be.reverted
            await snapshotGasCost(tx);
            await showAssetStatus("move 100% [1][0] to [1][1]：");
            expect((await hotPotFund.positions(1, 0)).isEmpty).to.eq(true);
            expect((await hotPotFund.positions(1, 1)).isEmpty).to.eq(false);
        })
    })

    async function addFeeToPool(tokenIn: Contract, tokenOut: Contract, amountIn: BigNumber) {
        const outAmount  = await fixture.quoter.callStatic.quoteExactInput(
          encodePath([tokenIn.address, tokenOut.address],[FeeAmount.MEDIUM]),
          amountIn
        );
        await (fixture.uniV3Router.connect(trader) as ISwapRouter).exactInputSingle({
            tokenIn: tokenIn.address, tokenOut: tokenOut.address, fee: FeeAmount.MEDIUM,
            recipient: trader.address, deadline: 1,
            amountIn: amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0
        });
        return outAmount;
    }

    async function showAddLavePercent(sumAmount: BigNumber, currentBalance: BigNumber) {
        const funds = await investToken.balanceOf(hotPotFund.address)
        const addedAmount = currentBalance.sub(funds)
        const percent = sumAmount.sub(addedAmount).mul(1e4).div(sumAmount).toNumber() / 1e2 + '%'
        IS_SHOW_LOG && console.log(`addLavePercent:${percent}`)
        return funds
    }

    async function showAssetStatus(tag?: string, isReturn?: boolean) {
        tag = tag || new Date().getTime()+""
        let expectedTotalAssets = BigNumber.from(0);
        let expectedAssets2DArr: Array<Array<BigNumber>> = [[]];

        if(!IS_SHOW_LOG && !isReturn) return {expectedTotalAssets, expectedAssets2DArr};

        IS_SHOW_LOG && console.group(tag);
        const poolsLength = await hotPotFund.poolsLength();
        for(let i = 0; i < poolsLength.toNumber(); i++){
            if (!expectedAssets2DArr[i]) expectedAssets2DArr[i] = []
            const [poolAddress, positionsLength, assets] =  await Promise.all([
                hotPotFund.pools(i),
                hotPotFund.positionsLength(i),
                hotPotFund.assetsOfPool(i)
            ]);
            const pool = poolAtAddress(poolAddress, manager)
            const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128] =  await Promise.all([
                pool.slot0(),
                pool.feeGrowthGlobal0X128(),
                pool.feeGrowthGlobal1X128()
            ]);
            let poolInfoStr = `pool[${i}]: ${assets}`;
            for(let j = 0; j < positionsLength.toNumber(); j++){
                const info = await hotPotFund.positions(i, j);
                const positionKey = getPositionKey(hotPotFund.address, info.tickLower, info.tickUpper);
                const uniV3 = await pool.positions(positionKey);
                const [assets, expectedAssets] = await Promise.all([
                    hotPotFund.assetsOfPosition(i, j),
                    getExpectedAssetsOfPosition({
                        token: investToken.address,
                        pool,
                        tickLower: info.tickLower,
                        tickUpper: info.tickUpper,
                        tickCurrent: slot0.tick,
                        sqrtPriceX96: slot0.sqrtPriceX96,
                        feeGrowthGlobal0X128,
                        feeGrowthGlobal1X128,
                        uniV3Factory: fixture.uniV3Factory.address,
                        wallet: manager,
                        tickMath: fixture.tickMath,
                        hotPotFund,
                    }, uniV3)
                ])
                poolInfoStr += `\n  ↳positions[${i}][${j}]: ${assets}`
                poolInfoStr += `\n    ↳info: ${info}`
                poolInfoStr += `\n    ↳uniV3: ${uniV3}`
                poolInfoStr += `\n    ↳expected: ${expectedAssets}`
                expectedTotalAssets = expectedTotalAssets.add(expectedAssets)
                expectedAssets2DArr[i][j] = expectedAssets;
            }
            IS_SHOW_LOG && console.log(poolInfoStr);
        }
        let totalAssets = await hotPotFund.totalAssets();
        let funds = await investToken.balanceOf(hotPotFund.address);
        expectedTotalAssets = expectedTotalAssets.add(funds);
        expect(totalAssets).to.eq(expectedTotalAssets);
        if(IS_SHOW_LOG){
            console.log(`funds: ${funds}`)
            console.log(`balance0：${await token0.balanceOf(hotPotFund.address)}`)
            console.log(`balance1：${await token1.balanceOf(hotPotFund.address)}`)
            console.log(`totalAssets: ${totalAssets}`)
            console.log(`totalSupply: ${await hotPotFund.totalSupply()}`)
            console.log(`balanceOfShare: ${await hotPotFund.balanceOf(depositor.address)}`)
            console.log(`totalInvestment: ${await hotPotFund.totalInvestment()}`)
            console.log(`investmentOf: ${await hotPotFund.investmentOf(depositor.address)}`)
            console.log(`balance0AtT0T1Pool：${await token0.balanceOf(t0T1Pool.address)}`)
            console.log(`balance1AtT0T1Pool：${await token1.balanceOf(t0T1Pool.address)}`)
            console.log(`balanceFAtFundT0Pool：${await investToken.balanceOf(fundT0Pool.address)}`)
            console.log(`balance0AtFundT0Pool：${await token0.balanceOf(fundT0Pool.address)}`)
            console.log(`balanceFAtFundT1Pool：${await investToken.balanceOf(fundT1Pool.address)}`)
            console.log(`balance1AtFundT1Pool：${await token1.balanceOf(fundT1Pool.address)}`)
            console.groupEnd();
        }
        return { expectedTotalAssets, expectedAssets2DArr }
    }

    async function getMyTicks(sqrtPriceX96: BigNumber, amplitude: number) {
        let tickLower = await fixture.tickMath.getTickAtSqrtRatio(sqrtPriceX96.mul(amplitude).div(100));
        let tickUpper = await fixture.tickMath.getTickAtSqrtRatio(sqrtPriceX96.mul(amplitude+100).div(100));
        if (tickLower % (TICK_SPACINGS[FeeAmount.MEDIUM]) != 0) {
            tickLower = Math.ceil(tickLower / (TICK_SPACINGS[FeeAmount.MEDIUM])) * (TICK_SPACINGS[FeeAmount.MEDIUM])
        }
        if (tickUpper % (TICK_SPACINGS[FeeAmount.MEDIUM]) != 0) {
            tickUpper = Math.floor(tickUpper / (TICK_SPACINGS[FeeAmount.MEDIUM])) * (TICK_SPACINGS[FeeAmount.MEDIUM])
        }
        return {tickLower, tickUpper};
    }

    describe("#withdraw", ()=>{
        beforeEach("set path and init position", async()=>{
            //path for token0
            await setPaths(
              token0.address,
              encodePath([investToken.address, token0.address], [FeeAmount.MEDIUM]),
              encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]))
            //path for token1
            await setPaths(
              token1.address,
              encodePath([investToken.address, token1.address], [FeeAmount.MEDIUM]),
              encodePath([token1.address, investToken.address], [FeeAmount.MEDIUM]))

            //deposit investToken
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor, INIT_DEPOSIT_AMOUNT);
            expect(await hotPotFund.balanceOf(depositor.address)).to.eq(INIT_DEPOSIT_AMOUNT);
            // other depositor
            await mintAndDepositHotPotFund(hotPotFund, investToken, depositor2, INIT_DEPOSIT_AMOUNT);
            expect(await hotPotFund.balanceOf(depositor2.address)).to.eq(INIT_DEPOSIT_AMOUNT);

            let ticks = await getMyTicks((await t0T1Pool.slot0()).sqrtPriceX96, 50);
            // init positions[0][0]: t0+t1 position
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              ticks.tickLower, ticks.tickUpper,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[0][1]: t0+t1 position
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              token0.address, token1.address, FeeAmount.MEDIUM,
              ticks.tickLower + TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              ticks.tickUpper - TICK_SPACINGS[FeeAmount.MEDIUM] * 10,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[1][0]: fund+t0 position
            // ticks = await getMyTicks((await fundT0Pool.slot0()).sqrtPriceX96, 50);
            let tokens = sortedTokens(investToken, token0);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              ticks.tickLower, ticks.tickUpper,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            // init positions[2][0]:: fund+t1 position
            // ticks = await getMyTicks((await fundT1Pool.slot0()).sqrtPriceX96, 50);
            tokens = sortedTokens(investToken, token1);
            await expect(fixture.controller.connect(manager).init(
              hotPotFund.address,
              tokens[0].address, tokens[1].address, FeeAmount.MEDIUM,
              ticks.tickLower, ticks.tickUpper,
              0,
              Math.round(new Date().getTime() / 1e3 + 12000)
            )).to.not.be.reverted
            expect(await hotPotFund.poolsLength()).to.eq(3);
            expect(await hotPotFund.positionsLength(0)).to.eq(2);
            expect(await hotPotFund.positionsLength(1)).to.eq(1);
            expect(await hotPotFund.positionsLength(2)).to.eq(1);
        })

        it("1 share > 0 && share <= balance", async () => {
            const share = await hotPotFund.balanceOf(depositor.address);
            await expect(hotPotFund.connect(depositor).withdraw(0, 5, Math.round(new Date().getTime() / 1e3 + 12000)))
              .to.be.revertedWith("ISA");
            await expect(hotPotFund.connect(depositor).withdraw(share.add(1), 5, Math.round(new Date().getTime() / 1e3 + 12000)))
              .to.be.revertedWith("ISA");
        })

        it("2 receive ETH if fund token is WET9", async () =>{
            if(investToken.address == fixture.weth9.address){
                const share = await hotPotFund.balanceOf(depositor.address);
                const balanceBefore = await depositor.getBalance();
                const removeToUserAmount = INIT_DEPOSIT_AMOUNT;

                const transaction = await hotPotFund.connect(depositor).withdraw(share, 5,
                  Math.round(new Date().getTime() / 1e3 + 12000), overrides);
                const gasFee = transaction.gasLimit.mul(transaction.gasPrice);
                const balanceAfter = await depositor.getBalance();

                await expect(Promise.resolve(transaction))
                  //WETH9 Withdrawal
                  .to.emit(investToken, "Withdrawal")
                  .withArgs(hotPotFund.address, removeToUserAmount)
                  .to.emit(hotPotFund, 'Withdraw')
                  .withArgs(depositor.address, INIT_DEPOSIT_AMOUNT, share)

                await expect(balanceAfter).be.gte(balanceBefore.add(removeToUserAmount).sub(gasFee));
            }
        })

        it("fail if the slippage is too big", async() => {
            await expect(fixture.controller.connect(governance).setMaxPriceImpact(200))
              .to.emit(fixture.controller, "SetMaxPriceImpact").withArgs(200);
            await expect(fixture.controller.add(
              hotPotFund.address,
              1, 0, INIT_DEPOSIT_AMOUNT.mul(2), false,
              Math.round(new Date().getTime() / 1e3 + 12000),
              overrides
            )).to.not.be.reverted

            //mock too large slippage withdraw
            const share = await hotPotFund.balanceOf(depositor.address);
            const swapAmount = await token0.decimals() == 18 ? INIT_DEPOSIT_AMOUNT_18 : INIT_DEPOSIT_AMOUNT_6;
            await token0.connect(depositor).transfer(fixture.testSlippage.address, swapAmount);
            await hotPotFund.connect(depositor).transfer(fixture.testSlippage.address, share);
            await expect(fixture.testSlippage.withdraw(
              token0.address, swapAmount, encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]),
              hotPotFund.address, share, INIT_DEPOSIT_AMOUNT)
            ).to.be.revertedWith('PSC');
            //user allow slippage value
            await expect(fixture.testSlippage.withdraw(
              token0.address, swapAmount, encodePath([token0.address, investToken.address], [FeeAmount.MEDIUM]),
              hotPotFund.address, share, INIT_DEPOSIT_AMOUNT.mul(1e3 - 10).div(1e3))
            ).to.not.be.reverted;
        });

        it('fail if the deadline expires', async () => {
            const share = await hotPotFund.balanceOf(depositor.address)
            await expect(hotPotFund.connect(depositor).withdraw(
              share, 5, Math.floor(new Date().getTime() / 1e3 - 12000))
            ).to.be.revertedWith('CDL')
        });

        describe("works", ()=>{
            it("withdraw immediately after deposit", async () =>{
                const share = await hotPotFund.balanceOf(depositor.address);
                const removeToUserAmount = INIT_DEPOSIT_AMOUNT;
                const tx = hotPotFund.connect(depositor).withdraw(share, 1, Math.round(new Date().getTime() / 1e3 + 12000), overrides);
                await expect(tx)
                    //burn share
                    .to.emit(hotPotFund, "Transfer")
                    .withArgs(depositor.address, constants.AddressZero, share)
                    //emit Withdraw
                    .to.emit(hotPotFund, 'Withdraw')
                    .withArgs(depositor.address, removeToUserAmount, share)

                if (investToken.address != fixture.weth9.address) {
                    await expect(tx)
                      //fundToken Transfer
                      .to.emit(investToken, "Transfer")
                      .withArgs(hotPotFund.address, depositor.address, removeToUserAmount)
                } else {
                    await expect(tx)
                      //WETH9 Withdrawal
                      .to.emit(investToken, "Withdrawal")
                      .withArgs(hotPotFund.address, removeToUserAmount)
                }
                await snapshotGasCost(tx);
            })

            it("withdraw when there is a profit", async () =>{
                await showAssetStatus("init status：");
                const sumFundAmount = INIT_DEPOSIT_AMOUNT;
                await expect(fixture.controller.add(
                  hotPotFund.address,
                  0, 0, sumFundAmount.mul(1).div(10), false,
                  Math.round(new Date().getTime() / 1e3 + 12000),
                  overrides
                )).to.not.be.reverted
                await showAssetStatus("add [0][0] 1/10：");
                let funds = await showAddLavePercent(sumFundAmount.mul(1).div(10), INIT_DEPOSIT_AMOUNT.mul(2));

                await expect(fixture.controller.add(
                  hotPotFund.address,
                  0, 1, sumFundAmount.mul(2).div(10), false,
                  Math.round(new Date().getTime() / 1e3 + 12000)
                )).to.not.be.reverted
                await showAssetStatus("add [0][1] 2/10：");
                funds = await showAddLavePercent(sumFundAmount.mul(2).div(10), funds);

                await expect(
                  fixture.controller.add(
                  hotPotFund.address,
                  1, 0, sumFundAmount.mul(3).div(10), false,
                  Math.round(new Date().getTime() / 1e3 + 12000)
                )).to.not.be.reverted
                await showAssetStatus("add [1][0] 3/10：");
                funds = await showAddLavePercent(sumFundAmount.mul(3).div(10), funds);

                await expect(fixture.controller.add(
                  hotPotFund.address,
                  2, 0, sumFundAmount.mul(4).div(10), false,
                  Math.round(new Date().getTime() / 1e3 + 12000)
                )).to.not.be.reverted
                await showAssetStatus("add [2][0] 4/10：");
                funds = await showAddLavePercent(sumFundAmount.mul(4).div(10), funds);

                //add swap fee for t0+t1 pool
                let outAmount = await addFeeToPool(token0, token1, INIT_DEPOSIT_AMOUNT)
                await addFeeToPool(token1, token0, outAmount)
                //add swap fee for fund+t0 pool
                outAmount = await addFeeToPool(investToken, token0, INIT_DEPOSIT_AMOUNT)
                await addFeeToPool(token0, investToken, outAmount)
                //add swap fee for fund+t1 pool
                outAmount = await addFeeToPool(investToken, token1, INIT_DEPOSIT_AMOUNT)
                await addFeeToPool(token1, investToken, outAmount)

                const totalInvestment = INIT_DEPOSIT_AMOUNT.mul(2);
                const investmentOf = INIT_DEPOSIT_AMOUNT;
                const expectedTotalShare = totalInvestment;
                const userTotalShare = investmentOf;
                const shareAmount = userTotalShare;
                //for test
                fixture.controller.connect(manager).setPath(hotPotFund.address, token2.address,
                  encodePath([investToken.address, token2.address], [FeeAmount.MEDIUM]));
                let expecteds = await showAssetStatus("add swap fee：", true);
                const { amount: removeToUserAmount, manager_fee, fee, investment: removeInvestment } =
                  await calExpectedWithdrawAmount(
                    shareAmount,
                    userTotalShare,
                    expectedTotalShare,
                    investmentOf,
                    await investToken.balanceOf(hotPotFund.address),
                    expecteds.expectedTotalAssets,
                    expecteds.expectedAssets2DArr,
                    investToken,
                    hotPotFund,
                    fixture,
                    manager
                );

                let tx = hotPotFund.connect(depositor).withdraw(shareAmount, 1, Math.round(new Date().getTime() / 1e3 + 12000), overrides);
                await expect(tx)
                  //burn share
                  .to.emit(hotPotFund, "Transfer")
                  .withArgs(depositor.address, constants.AddressZero, shareAmount)
                  //emit Withdraw
                  .to.emit(hotPotFund, 'Withdraw')
                  .withArgs(depositor.address, removeToUserAmount, shareAmount)

                if (investToken.address != fixture.weth9.address) {
                    await expect(tx)
                      //fundToken Transfer
                      .to.emit(investToken, "Transfer")
                      .withArgs(hotPotFund.address, depositor.address, removeToUserAmount)
                } else {
                    await expect(tx)
                      //WETH9 Withdrawal
                      .to.emit(investToken, "Withdrawal")
                      .withArgs(hotPotFund.address, removeToUserAmount)
                }
                await snapshotGasCost(tx);
                expecteds = await showAssetStatus('depositor withdraw：', true);
                await expect(await hotPotFund.totalAssets()).to.eq(expecteds.expectedTotalAssets);

                //totalSupply
                await expect(await hotPotFund.totalSupply()).to.eq(expectedTotalShare.sub(shareAmount));
                //totalAssets
                await expect(await hotPotFund.totalAssets()).to.eq(expecteds.expectedTotalAssets);
                //investmentOf
                await expect(await hotPotFund.investmentOf(depositor.address)).to.eq(investmentOf.sub(removeInvestment));
                //totalInvestment
                await expect(await hotPotFund.totalInvestment()).to.eq(totalInvestment.sub(removeInvestment));
                //balanceOf
                await expect(await hotPotFund.balanceOf(depositor.address)).to.eq(userTotalShare.sub(shareAmount));

                //depositor2 withdraw all
                tx = hotPotFund.connect(depositor2).withdraw(await hotPotFund.balanceOf(depositor2.address), 1, Math.round(new Date().getTime() / 1e3 + 12000));
                await expect(tx).to.not.be.reverted;
                await snapshotGasCost(tx);
                await showAssetStatus("depositor2 withdraw：");
                await expect(await hotPotFund.totalSupply()).to.eq(0);
                await expect(await hotPotFund.totalAssets()).to.eq(0);
            })
        })
    })
});
