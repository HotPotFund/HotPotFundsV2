import { BigNumber, utils } from 'ethers'

export function computeFundAddress(factory: string,
                                   manager: string,
                                   token: string,
                                   lockPeriod: number,
                                   baseLine: number,
                                   managerFee: number,
                                   fundByteCode: string): string {
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint', 'uint', 'uint'],
    [manager, token, lockPeriod, baseLine, managerFee]
  )

  const FUND_BYTECODE_HASH = utils.keccak256(fundByteCode)

  const create2Inputs = [
    '0xff',
    factory,
    // salt
    utils.keccak256(constructorArgumentsEncoded),
    // init code hash
    FUND_BYTECODE_HASH
  ]
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}
