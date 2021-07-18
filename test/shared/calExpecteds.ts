import { BigNumber, Contract, Wallet } from 'ethers'
import { FeeAmount, FixedPoint128, FixedPoint96 } from './constants'
import { decodePath, hasMultiplePools, skipToken } from './path'
import { computePoolAddress } from './computePoolAddress'
import { CompleteFixture } from './completeFixture'
import poolAtAddress from './poolAtAddress'
import { getPositionKey } from './utils'
import { IUniswapV3Pool } from '../../typechain/IUniswapV3Pool'
import { TickMathTest } from '../../typechain/TickMathTest'
import { IHotPotV2Fund } from '../../typechain/IHotPotV2Fund'

const FEE = BigNumber.from(10).mul(BigNumber.from(2).pow(128))
const MANAGER_FEE = BigNumber.from(10).mul(BigNumber.from(2).pow(128))
const DIVISOR = BigNumber.from(100).mul(BigNumber.from(2).pow(128))

/**
 * (△x-△x0)*SPc^2/△x0 = Z
 *                    Z = (SPc-SPl)*SPc*SPu/(SPu-SPc)
 *       (△x-△x0)/△x0 = (SPc-SPl)*SPu/((SPu-SPc)*SPc)
 *             △x-△x0 = SPu*(SPc-SPl)/(SPc*(SPu-SPc)) * △x0
 *                 △x0 = △x/( SPu*(SPc-SPl)/(SPc*(SPu-SPc)) + 1 )
 */
export function getAmountsForAmount0(
  sqrtPriceX96: BigNumber,
  sqrtPriceL96: BigNumber,
  sqrtPriceU96: BigNumber,
  deltaX: BigNumber
) {
  let amount0: BigNumber = BigNumber.from(0)
  let amount1: BigNumber = BigNumber.from(0)
  // 全部是t0
  if (sqrtPriceX96.lte(sqrtPriceL96)) {
    amount0 = deltaX
  }
  // 部分t0
  else if (sqrtPriceX96.lt(sqrtPriceU96)) {
    // a = SPu*(SPc - SPl)
    const a96 = sqrtPriceU96.mul(sqrtPriceX96.sub(sqrtPriceL96)).div(FixedPoint96.Q96)
    // b = SPc*(SPu - SPc)
    const b96 = sqrtPriceX96.mul(sqrtPriceU96.sub(sqrtPriceX96)).div(FixedPoint96.Q96)
    // △x0 = △x/(a/b +1) = △x*b/(a+b)
    amount0 = deltaX.mul(b96).div(a96.add(b96))
  }

  //剩余的转成t1
  if (deltaX.gt(amount0)) {
    const priceX96 = sqrtPriceX96.mul(sqrtPriceX96).div(FixedPoint96.Q96)
    amount1 = deltaX.sub(amount0).mul(priceX96).div(FixedPoint96.Q96)
  }

  return { amount0, amount1 }
}


async function getSqrtPriceX96(uniV3Factory: string, path: string, tickMath: TickMathTest, wallet: Wallet, isCurrentPrice: boolean) {
  let sqrtPriceX96 = BigNumber.from(2).pow(FixedPoint96.RESOLUTION)
  while (true) {
    const hasMultiplePool = hasMultiplePools(path)
    const [[tokenIn, tokenOut], [fee]] = decodePath(path)

    let _sqrtPriceX96
    if (isCurrentPrice) {
      const pool = poolAtAddress(computePoolAddress(uniV3Factory, [tokenIn, tokenOut], FeeAmount.MEDIUM), wallet)
      _sqrtPriceX96 = (await pool.slot0()).sqrtPriceX96
    } else {
      const pool = poolAtAddress(computePoolAddress(uniV3Factory, [tokenIn, tokenOut], FeeAmount.MEDIUM), wallet)
      let tickCumulatives = (await pool.observe([0, 1])).tickCumulatives
      _sqrtPriceX96 = await tickMath.getSqrtRatioAtTick(tickCumulatives[0].sub(tickCumulatives[1]))
    }

    sqrtPriceX96 = tokenIn.toLowerCase() > tokenOut.toLowerCase()
      ? sqrtPriceX96.mul(FixedPoint96.Q96).div(_sqrtPriceX96)
      : sqrtPriceX96.mul(_sqrtPriceX96).div(FixedPoint96.Q96)

    // decide whether to continue or terminate
    if (hasMultiplePool)
      path = '0x' + skipToken(path)
    else
      return sqrtPriceX96
  }
}

interface FeeGrowthInsideParams {
  // 交易对地址
  pool: IUniswapV3Pool,
  // The lower tick boundary of the position
  tickLower: number
  // The upper tick boundary of the position
  tickUpper: number
  // The current tick
  tickCurrent: number
  // The all-time global fee growth, per unit of liquidity, in token0
  feeGrowthGlobal0X128: BigNumber,
  // The all-time global fee growth, per unit of liquidity, in token1
  feeGrowthGlobal1X128: BigNumber,
}


async function getFeeGrowthInside(params: FeeGrowthInsideParams) {
  let feeGrowthInside0X128, feeGrowthInside1X128
  const _pool = params.pool

  // calculate fee growth below
  const {
    feeGrowthOutside0X128: lower_feeGrowthOutside0X128,
    feeGrowthOutside1X128: lower_feeGrowthOutside1X128
  } = await _pool.ticks(params.tickLower)

  let feeGrowthBelow0X128
  let feeGrowthBelow1X128
  if (params.tickCurrent >= params.tickLower) {
    feeGrowthBelow0X128 = lower_feeGrowthOutside0X128
    feeGrowthBelow1X128 = lower_feeGrowthOutside1X128
  } else {
    feeGrowthBelow0X128 = params.feeGrowthGlobal0X128.sub(lower_feeGrowthOutside0X128)
    feeGrowthBelow1X128 = params.feeGrowthGlobal1X128.sub(lower_feeGrowthOutside1X128)
  }

  // calculate fee growth above
  const {
    feeGrowthOutside0X128: upper_feeGrowthOutside0X128,
    feeGrowthOutside1X128: upper_feeGrowthOutside1X128
  } = await _pool.ticks(params.tickUpper)

  let feeGrowthAbove0X128
  let feeGrowthAbove1X128
  if (params.tickCurrent < params.tickUpper) {
    feeGrowthAbove0X128 = upper_feeGrowthOutside0X128
    feeGrowthAbove1X128 = upper_feeGrowthOutside1X128
  } else {
    feeGrowthAbove0X128 = params.feeGrowthGlobal0X128.sub(upper_feeGrowthOutside0X128)
    feeGrowthAbove1X128 = params.feeGrowthGlobal1X128.sub(upper_feeGrowthOutside1X128)
  }

  feeGrowthInside0X128 = params.feeGrowthGlobal0X128.sub(feeGrowthBelow0X128).sub(feeGrowthAbove0X128)
  feeGrowthInside1X128 = params.feeGrowthGlobal1X128.sub(feeGrowthBelow1X128).sub(feeGrowthAbove1X128)

  return { feeGrowthInside0X128, feeGrowthInside1X128 }
}

interface AssetsOfPosition {
  // 基金本币
  token: string;
  // 交易对地址.
  pool: IUniswapV3Pool,
  // 价格刻度下届
  tickLower: number,
  // 价格刻度上届
  tickUpper: number,
  // 当前价格刻度
  tickCurrent: number,
  // 当前价格
  sqrtPriceX96: BigNumber,
  // 全局手续费变量(token0)
  feeGrowthGlobal0X128: BigNumber,
  // 全局手续费变量(token1)
  feeGrowthGlobal1X128: BigNumber,

  uniV3Factory: string,
  wallet: Wallet,
  tickMath: TickMathTest,
  hotPotFund: IHotPotV2Fund,
}


export async function getExpectedAssetsOfPosition(params: AssetsOfPosition, uniV3: any) {
  const pool = params.pool
  const {
    _liquidity = uniV3[0],
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0,
    tokensOwed1
  } = uniV3

  let amount, amount0, amount1

  // get global feeGrowthInside
  const { feeGrowthInside0X128, feeGrowthInside1X128 } = await getFeeGrowthInside({
    pool: params.pool,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    tickCurrent: params.tickCurrent,
    feeGrowthGlobal0X128: params.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: params.feeGrowthGlobal1X128
  })

  // calculate accumulated fees
  amount0 = (feeGrowthInside0X128.sub(feeGrowthInside0LastX128)).mul(_liquidity).div(FixedPoint128.Q128)
  amount1 = (feeGrowthInside1X128.sub(feeGrowthInside1LastX128)).mul(_liquidity).div(FixedPoint128.Q128)

  // 计算总的手续费.
  // overflow is acceptable, have to withdraw before you hit type(uint128).max fees
  amount0 = amount0.add(tokensOwed0)
  amount1 = amount1.add(tokensOwed1)

  // 计算流动性资产
  if (params.tickCurrent < params.tickLower) {
    // current tick is below the passed range; liquidity can only become in range by crossing from left to
    // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
    amount0 = amount0.add(getAmount0Delta(
      await params.tickMath.getSqrtRatioAtTick(params.tickLower),
      await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
      _liquidity,
      true
    ))
  } else if (params.tickCurrent < params.tickUpper) {
    // current tick is inside the passed range
    amount0 = amount0.add(getAmount0Delta(
      params.sqrtPriceX96,
      await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
      _liquidity,
      true
    ))
    amount1 = amount1.add(getAmount1Delta(
      await params.tickMath.getSqrtRatioAtTick(params.tickLower),
      params.sqrtPriceX96,
      _liquidity,
      true
    ))
  } else {
    // current tick is above the passed range; liquidity can only become in range by crossing from right to
    // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
    amount1 = amount1.add(
      getAmount1Delta(
        await params.tickMath.getSqrtRatioAtTick(params.tickLower),
        await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
        _liquidity,
        true
      ))
  }

  // 计算以本币衡量的资产.
  let token0 = await pool.token0()
  if (token0.toLowerCase() != params.token.toLowerCase()) {
    let price0 = await getSqrtPriceX96(params.uniV3Factory, await params.hotPotFund.sellPath(token0), params.tickMath, params.wallet, false)
    amount = amount0.mul(price0.mul(price0).div(FixedPoint96.Q96)).div(FixedPoint96.Q96)
  } else amount = amount0

  let token1 = await pool.token1()
  if (token1.toLowerCase() != params.token.toLowerCase()) {
    let price1 = await getSqrtPriceX96(params.uniV3Factory, await params.hotPotFund.sellPath(token1), params.tickMath, params.wallet, false)
    amount = amount.add(
      amount1.mul(price1.mul(price1).div(FixedPoint96.Q96)).div(FixedPoint96.Q96)
    )
  } else amount = amount.add(amount1)

  return amount
}

export async function getSubAssets(params: AssetsOfPosition,
                                   uniV3: any,
                                   subProportionX128: BigNumber,
                                   fixture: CompleteFixture) {
  const pool = params.pool
  const {
    _liquidity = uniV3[0],
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0,
    tokensOwed1
  } = uniV3

  let amount = BigNumber.from(0), amount0, amount1

  // get global feeGrowthInside
  const { feeGrowthInside0X128, feeGrowthInside1X128 } = await getFeeGrowthInside({
    pool: params.pool,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    tickCurrent: params.tickCurrent,
    feeGrowthGlobal0X128: params.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: params.feeGrowthGlobal1X128
  })

  // calculate accumulated fees
  amount0 = (feeGrowthInside0X128.sub(feeGrowthInside0LastX128)).mul(_liquidity).div(FixedPoint128.Q128)
  amount1 = (feeGrowthInside1X128.sub(feeGrowthInside1LastX128)).mul(_liquidity).div(FixedPoint128.Q128)

  // 计算总的手续费.
  // overflow is acceptable, have to withdraw before you hit type(uint128).max fees
  amount0 = amount0.add(tokensOwed0)
  amount1 = amount1.add(tokensOwed1)

  let subLp = subProportionX128.mul(_liquidity).div(DIVISOR)
  // 计算流动性资产
  if (params.tickCurrent < params.tickLower) {
    // current tick is below the passed range; liquidity can only become in range by crossing from left to
    // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
    amount0 = amount0.add(getAmount0Delta(
      await params.tickMath.getSqrtRatioAtTick(params.tickLower),
      await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
      subLp,
      true
    ))
  } else if (params.tickCurrent < params.tickUpper) {
    // current tick is inside the passed range
    amount0 = amount0.add(getAmount0Delta(
      params.sqrtPriceX96,
      await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
      subLp,
      true
    ))
    amount1 = amount1.add(getAmount1Delta(
      await params.tickMath.getSqrtRatioAtTick(params.tickLower),
      params.sqrtPriceX96,
      subLp,
      true
    ))
  } else {
    // current tick is above the passed range; liquidity can only become in range by crossing from right to
    // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
    amount1 = amount1.add(
      getAmount1Delta(
        await params.tickMath.getSqrtRatioAtTick(params.tickLower),
        await params.tickMath.getSqrtRatioAtTick(params.tickUpper),
        subLp,
        true
      ))
  }

  // 计算以本币衡量的资产.
  const token0 = await pool.token0()
  if (token0.toLowerCase() != params.token.toLowerCase()) {
    if (amount0.gt(0))
      amount = await fixture.quoter.callStatic.quoteExactInput(await params.hotPotFund.sellPath(token0), amount0)
  } else amount = amount0
  const token1 = await pool.token1()
  if (token1.toLowerCase() != params.token.toLowerCase()) {
    if (amount1.gt(0))
      amount = amount.add(await fixture.quoter.callStatic.quoteExactInput(await params.hotPotFund.sellPath(token1), amount1))
  } else amount = amount.add(amount1)

  return amount
}

function divRoundingUp(x: BigNumber, y: BigNumber) {
  return x.div(y).add(x.mod(y).gt(0) ? 1 : 0)
}

function mulDivRoundingUp(a: BigNumber, b: BigNumber, denominator: BigNumber) {
  let result = a.mul(b).div(denominator)
  if (a.mul(b).mod(denominator).gt(0)) result = result.add(1)
  return result
}

function getAmount0DeltaAmount(
  sqrtRatioAX96: BigNumber,
  sqrtRatioBX96: BigNumber,
  liquidity: BigNumber,
  roundUp: boolean
) {
  if (sqrtRatioAX96.gt(sqrtRatioBX96)) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]

  let amount0

  let numerator1 = liquidity.mul(BigNumber.from(2).pow(FixedPoint96.RESOLUTION))
  let numerator2 = sqrtRatioBX96.sub(sqrtRatioAX96)

  amount0 = roundUp
    ? divRoundingUp(
      numerator1.mul(numerator2).div(sqrtRatioBX96), sqrtRatioAX96
    )
    : numerator1.mul(numerator2).div(sqrtRatioBX96).div(sqrtRatioAX96)

  return amount0
}

function getAmount1DeltaAmount(
  sqrtRatioAX96: BigNumber,
  sqrtRatioBX96: BigNumber,
  liquidity: BigNumber,
  roundUp: boolean
) {
  if (sqrtRatioAX96.gt(sqrtRatioBX96)) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]

  return roundUp
    ? mulDivRoundingUp(liquidity, sqrtRatioBX96.sub(sqrtRatioAX96), FixedPoint96.Q96)
    : liquidity.mul(sqrtRatioBX96.sub(sqrtRatioAX96)).div(FixedPoint96.Q96)
}

function getAmount0Delta(
  sqrtRatioAX96: BigNumber,
  sqrtRatioBX96: BigNumber,
  liquidity: BigNumber,
  isRemoveLP: boolean
) {
  if (isRemoveLP) {
    return getAmount0DeltaAmount(sqrtRatioAX96, sqrtRatioBX96, liquidity, false)
  } else {
    return getAmount0DeltaAmount(sqrtRatioAX96, sqrtRatioBX96, liquidity, true)
  }
}

function getAmount1Delta(
  sqrtRatioAX96: BigNumber,
  sqrtRatioBX96: BigNumber,
  liquidity: BigNumber,
  isRemoveLP: boolean
) {
  if (isRemoveLP) {
    return getAmount1DeltaAmount(sqrtRatioAX96, sqrtRatioBX96, liquidity, false)
  } else {
    return getAmount1DeltaAmount(sqrtRatioAX96, sqrtRatioBX96, liquidity, true)
  }
}


function maxWith2DArr(arr: BigNumber[][]) {
  let index1 = 0
  let index2 = 0
  let value = BigNumber.from(0)

  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr[i].length; j++) {
      if (arr[i][j].gt(value)) {
        index1 = i
        index2 = j
        value = arr[i][j]
      }
    }
  }

  return { index1, index2, value }
}

export async function calExpectedWithdrawAmount(removeShare: BigNumber,
                                                userTotalShare: BigNumber,
                                                totalShare: BigNumber,
                                                investmentOf: BigNumber,
                                                fundBalance: BigNumber,
                                                totalAssets: BigNumber,
                                                assetsOfPosition: Array<Array<BigNumber>>,
                                                investToken: Contract,
                                                hotPotFund: IHotPotV2Fund,
                                                fixture: CompleteFixture,
                                                manager: Wallet) {
  let investment = investmentOf.mul(removeShare).div(userTotalShare)
  let amount = totalAssets.mul(removeShare).div(totalShare)

  let totalAssets1 = await hotPotFund.totalAssets()
  // 还需要从大到小从头寸中撤资.
  if (amount.gt(fundBalance)) {
    let remainingAmount = amount.sub(fundBalance)
    while (true) {
      // 取最大的头寸索引号
      const { index1: poolIndex, index2: positionIndex, value: desirableAmount } = maxWith2DArr(assetsOfPosition)
      if (desirableAmount.eq(0)) break

      const pool = poolAtAddress(await hotPotFund.pools(poolIndex), manager)
      const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128] = await Promise.all([
        pool.slot0(),
        pool.feeGrowthGlobal0X128(),
        pool.feeGrowthGlobal1X128()
      ])
      const info = await hotPotFund.positions(poolIndex, positionIndex)
      const positionKey = getPositionKey(hotPotFund.address, info.tickLower, info.tickUpper)
      const uniV3 = await pool.positions(positionKey)

      if (remainingAmount.lte(desirableAmount)) {
        let temp = await getSubAssets({
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
            hotPotFund
          }, uniV3, remainingAmount.mul(DIVISOR).div(desirableAmount),
          fixture)

        fundBalance = fundBalance.add(temp)
        break
      } else {
        let temp = await getSubAssets({
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
          hotPotFund
        }, uniV3, DIVISOR, fixture)

        fundBalance = fundBalance.add(temp)

        remainingAmount = remainingAmount.sub(desirableAmount)
        assetsOfPosition[poolIndex][positionIndex] = BigNumber.from(0)
      }
    }
    if (amount.gt(fundBalance))
      amount = fundBalance
    else if (totalShare.eq(removeShare))
      amount = fundBalance
  }

  let manager_fee = BigNumber.from(0), fee = BigNumber.from(0)
  // 处理基金经理分成和基金分成
  if (amount.gt(investment)) {
    manager_fee = amount.sub(investment).mul(MANAGER_FEE).div(DIVISOR)
    fee = amount.sub(investment).mul(FEE).div(DIVISOR)
    amount = amount.sub(fee).sub(manager_fee)
  } else
    investment = amount

  // console.log('withdraw:', { amount, manager_fee, fee, investment })
  return { amount, manager_fee, fee, investment }
}
