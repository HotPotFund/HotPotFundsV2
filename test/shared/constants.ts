import { BigNumber } from 'ethers'

export const MaxUint128 = BigNumber.from(2).pow(128).sub(1)

export enum FeeAmount {
  LOW = 500,//0.05%
  MEDIUM = 3000,//0.3%
  HIGH = 10000,//1%
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
}

export const FixedPoint64 = {
  Q64: BigNumber.from('0x10000000000000000'),
  RESOLUTION: 64
}

export const FixedPoint96 = {
  Q96: BigNumber.from('0x1000000000000000000000000'),
  RESOLUTION: 96
}

export const FixedPoint128 = {
  Q128: BigNumber.from('0x100000000000000000000000000000000'),
  RESOLUTION: 128
}
