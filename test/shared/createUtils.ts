import { constants, Contract, utils, Wallet } from 'ethers'

import { FeeAmount, TICK_SPACINGS } from './constants'
import { encodePriceSqrt, sortedTokens } from './utils'
import { DEFAULT_FEE, INIT_PAIR_LP_AMOUNT_18, INIT_PAIR_LP_AMOUNT_6, INIT_PAIR_LP_AMOUNT_ETH } from './fixtures'
import poolAtAddress from './poolAtAddress'
import { computePoolAddress } from './computePoolAddress'
import HotPotV2FundAbi from '../../artifacts/contracts/HotPotV2Fund.sol/HotPotV2Fund.json'
import { IHotPotV2Fund, IHotPotV2FundFactory } from '../../typechain'
import { CompleteFixture } from './completeFixture'


export async function createUniV3PoolAndInit(miner: Wallet,
                                             fixture: CompleteFixture,
                                             tokenA: Contract,
                                             tokenB: Contract) {
  const tokens = sortedTokens(tokenA, tokenB);
  const token0 = (tokens[0] as Contract).connect(miner);
  const token1 = (tokens[1] as Contract).connect(miner);
  await token0.approve(fixture.nft.address, 0);
  await token0.approve(fixture.nft.address, constants.MaxUint256);
  await token1.approve(fixture.nft.address, 0);
  await token1.approve(fixture.nft.address, constants.MaxUint256);

  let amount0 = await token0.decimals() == 18 ? INIT_PAIR_LP_AMOUNT_18 : INIT_PAIR_LP_AMOUNT_6
  let amount1 = await token1.decimals() == 18 ? INIT_PAIR_LP_AMOUNT_18 : INIT_PAIR_LP_AMOUNT_6;
  if (token0.address == fixture.weth9.address) amount0 = INIT_PAIR_LP_AMOUNT_ETH;
  if (token1.address == fixture.weth9.address) amount1 = INIT_PAIR_LP_AMOUNT_ETH

  const sqrtPriceX96 = encodePriceSqrt(amount1, amount0);
  const tick = await fixture.tickMath.getTickAtSqrtRatio(sqrtPriceX96);
  const tickSpacing = TICK_SPACINGS[DEFAULT_FEE];
  const tickLower = Math.floor((tick - 5000) / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor((tick + 5000) / tickSpacing) * tickSpacing;

  await fixture.nft.createAndInitializePoolIfNecessary(
    token0.address, token1.address, FeeAmount.MEDIUM, sqrtPriceX96);
  let pool =  poolAtAddress(computePoolAddress(await fixture.nft.factory(), [token0.address, token1.address], FeeAmount.MEDIUM), miner);
  await pool.increaseObservationCardinalityNext(2);
  const params = {
    token0: token0.address, token1: token1.address, fee: DEFAULT_FEE,
    tickLower: tickLower, tickUpper: tickUpper,
    amount0Desired: amount0, amount1Desired: amount1,
    amount0Min: 0, amount1Min: 0,
    recipient: miner.address,
    deadline: 1
  };
  await fixture.nft.mint(params);
  return pool;
}


export async function createFund(manager: Wallet,
                                 token: Contract,
                                 depositor: string,
                                 hotPotFactory: IHotPotV2FundFactory) {
  await hotPotFactory.connect(manager).createFund(token.address, utils.formatBytes32String(depositor));
  const fundAddress = await hotPotFactory.getFund(manager.address, token.address);
  return new Contract(fundAddress, HotPotV2FundAbi.abi, hotPotFactory.provider) as IHotPotV2Fund;
}








