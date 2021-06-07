import { utils } from 'ethers'

export function computeFundAddress(factory: string,
                                   manager: string,
                                   token: string,
                                   fundByteCode: string): string {
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ['address', 'address'],
    [manager, token]
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
