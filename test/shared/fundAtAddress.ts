import { abi as FUND_ABI } from '../../artifacts/contracts/HotPotV2Fund.sol/HotPotV2Fund.json'
import { Contract, Wallet } from 'ethers'
import { IHotPotV2Fund } from '../../typechain'

export default function fundAtAddress(address: string, wallet: Wallet): IHotPotV2Fund {
  return new Contract(address, FUND_ABI, wallet) as IHotPotV2Fund
}
