import { utils } from 'ethers'
import { FeeAmount } from './constants'

const ADDR_SIZE = 20
const FEE_SIZE = 3
const NEXT_OFFSET = ADDR_SIZE + FEE_SIZE//23
const POP_OFFSET = NEXT_OFFSET + ADDR_SIZE//20+3+20
const MULTIPLE_POOLS_MIN_LENGTH = POP_OFFSET + NEXT_OFFSET//20+3+20+20+3

export function encodePath(path: string[], fees: FeeAmount[]): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }

  let encoded = '0x'
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

function decodeOne(tokenFeeToken: Buffer): [[string, string], number] {
  // reads the first 20 bytes for the token address
  const tokenABuf = tokenFeeToken.slice(0, ADDR_SIZE)
  const tokenA = utils.getAddress('0x' + tokenABuf.toString('hex'))

  // reads the next 2 bytes for the fee
  const feeBuf = tokenFeeToken.slice(ADDR_SIZE, NEXT_OFFSET)
  const fee = feeBuf.readUIntBE(0, FEE_SIZE)

  // reads the next 20 bytes for the token address
  const tokenBBuf = tokenFeeToken.slice(NEXT_OFFSET, POP_OFFSET)
  const tokenB = utils.getAddress('0x' + tokenBBuf.toString('hex'))

  return [[tokenA, tokenB], fee]
}

//start with 0x string
export function decodePath(path: string): [string[], number[]] {
  let data = Buffer.from(path.slice(2), 'hex')

  let tokens: string[] = []
  let fees: number[] = []
  let i = 0
  let finalToken: string = ''
  while (data.length >= POP_OFFSET) {
    const [[tokenA, tokenB], fee] = decodeOne(data)
    finalToken = tokenB
    tokens = [...tokens, tokenA]
    fees = [...fees, fee]
    data = data.slice((i + 1) * NEXT_OFFSET)
    i += 1
  }
  tokens = [...tokens, finalToken]

  return [tokens, fees]
}

//no-start with 0x string
export function skipToken(path: string = ''): string {
  path = path.replace('0x', '')
  return path.slice(NEXT_OFFSET * 2)
}

export function hasMultiplePools(path: string = ''): boolean {
  path = path.replace('0x', '')
  return path.length >= MULTIPLE_POOLS_MIN_LENGTH * 2
}
