import bn from 'bignumber.js'
import { BigNumber, BigNumberish, Contract, ContractTransaction, providers, utils, Wallet } from 'ethers'
import { expect } from './expect'
import { TransactionReceipt, TransactionResponse } from '@ethersproject/abstract-provider'

export const MIN_SQRT_RATIO = BigNumber.from('4295128739')
export const MAX_SQRT_RATIO = BigNumber.from('1461446703485210103287273052203988822378723970342')

/*****expandToDecimals*******/
export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function expandTo6Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(6))
}

/*****encodePriceSqrt*******/
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })
// returns the sqrt price as a 64x96
export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}

/*****token sorts*******/
export function compareToken(a: { address: string }, b: { address: string }): -1 | 1 {
  return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
}

export function sortedTokens(
  a: { address: string },
  b: { address: string }
): [typeof a, typeof b] | [typeof b, typeof a] {
  return compareToken(a, b) < 0 ? [a, b] : [b, a]
}


/*****snapshotGasCost*******/
export async function snapshotGasCost(
  x:
    | TransactionResponse
    | Promise<TransactionResponse>
    | ContractTransaction
    | Promise<ContractTransaction>
    | TransactionReceipt
    | Promise<BigNumber>
    | BigNumber
    | Contract
    | Promise<Contract>
): Promise<void> {
  const resolved = await x
  if ('deployTransaction' in resolved) {
    const receipt = await resolved.deployTransaction.wait()
    expect(receipt.gasUsed.toNumber()).toMatchSnapshot()
  } else if ('wait' in resolved) {
    const waited = await resolved.wait()
    expect(waited.gasUsed.toNumber()).toMatchSnapshot()
  } else if (BigNumber.isBigNumber(resolved)) {
    expect(resolved.toNumber()).toMatchSnapshot()
  }
}

/*****calPositionKey*******/
export function getPositionKey(address: string, lowerTick: number, upperTick: number): string {
  return utils.keccak256(utils.solidityPack(['address', 'int24', 'int24'], [address, lowerTick, upperTick]))
}

export async function getTransactionTimestamp(provider: providers.Web3Provider, txhash: string) {
  const rs = await provider.getTransaction(txhash);
  const {timestamp} = await provider.getBlock(rs.blockNumber as number);

  return BigNumber.from(timestamp);
}

export function printGasLimit(transaction: any, tag?: string) {
  console.log(`gasLimit${!tag ? "" : "-" + tag}: ${transaction.gasLimit}`);
}
