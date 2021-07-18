import { Fixture, MockProvider } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { v3RouterFixture } from './externalFixtures'
import { constants, Contract, Wallet } from 'ethers'
import {
  IWETH9,
  IUniswapV3Factory,
  ISwapRouter,
  INonfungiblePositionManager,
  IHotPotV2FundFactory,
  IHotPotV2FundController,
  TickMathTest
} from '../../typechain'
import { IHotPot } from '../../typechain/IHotPot'
import { IQuoter } from '../../typechain/IQuoter'
import {TestHarvest} from "../../typechain/TestHarvest";


export async function controllerFixture(params: {
  weth9: string,
  hotpot: string,
  governance: string,
  uniV3Router: string,
  uniV3Factory: string
}, [wallet]: Wallet[], provider: MockProvider): Promise<IHotPotV2FundController> {
  const controllerFactory = await ethers.getContractFactory('HotPotV2FundController')
  return (await controllerFactory.deploy(params.hotpot, params.governance, params.uniV3Router, params.uniV3Factory, params.weth9)) as IHotPotV2FundController
}

export async function factoryFixture(params: {
  controller: string,
  weth9: string,
  uniV3Factory: string,
  uniV3Router: string
}, wallets: Wallet[], provider: MockProvider): Promise<{
  factory: IHotPotV2FundFactory,
  positionLib: string
}> {
  const positionLibraryFactory = await ethers.getContractFactory('Position')
  const positionLibrary = await positionLibraryFactory.deploy()
  const factoryFactory = await ethers.getContractFactory(
    'HotPotV2FundFactory', {
      libraries: {
        Position: positionLibrary.address
      }
    })

  const factory = (await factoryFactory.deploy(params.controller, params.weth9, params.uniV3Factory, params.uniV3Router)) as IHotPotV2FundFactory
  return { factory, positionLib: positionLibrary.address }
}

export interface CompleteFixture {
  weth9: IWETH9
  uniV3Factory: IUniswapV3Factory
  uniV3Router: ISwapRouter
  nft: INonfungiblePositionManager
  tokens: Array<Contract>,
  tokenHotPot: IHotPot,
  factory: IHotPotV2FundFactory,
  controller: IHotPotV2FundController,
  positionLib: string,
  fundByteCode: string,
  quoter: IQuoter,
  testHarvest: TestHarvest,
  tickMath: TickMathTest
}

async function completeFixture(wallets: Wallet[],
                               provider: MockProvider,
                               governance?: Wallet): Promise<CompleteFixture> {
  const { weth9, factory: uniV3Factory, router: uniV3Router } = await v3RouterFixture(wallets, provider)

  const erc20Factory = await ethers.getContractFactory('ERC20Mock')
  const usdtFactory = await ethers.getContractFactory('ERC20MockNoReturn')
  const tokens = (await Promise.all([
    // do not use maxu256 to avoid overflowing
    usdtFactory.deploy(constants.MaxUint256.div(1e2), 'USDT-TS', 'USDT', 6),
    erc20Factory.deploy(constants.MaxUint256.div(1e2), 'DAI-TS', 'DAI', 18),
    erc20Factory.deploy(constants.MaxUint256.div(1e2), 'UNI-TS', 'UNI', 18),
    erc20Factory.deploy(constants.MaxUint256.div(1e2), 'YFI-TS', 'YFI', 18),
    erc20Factory.deploy(constants.MaxUint256.div(1e2), 'USDC-TS', 'USDC', 6)
  ])) as Array<Contract>

  const tokenHotPotFactory = await ethers.getContractFactory('HotPot')

  const tokenHotPot = await tokenHotPotFactory.deploy(wallets[0].address) as IHotPot

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor')
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
  const positionDescriptorFactory = await ethers.getContractFactory(
    'NonfungibleTokenPositionDescriptor', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address
      }
    })
  const positionDescriptor = await positionDescriptorFactory.deploy(weth9.address)

  const positionManagerFactory = await ethers.getContractFactory('MockTimeNonfungiblePositionManager')
  const nft = (await positionManagerFactory.deploy(
    uniV3Factory.address,
    weth9.address,
    positionDescriptor.address
  )) as INonfungiblePositionManager

  // tokens.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))

  const controller = await controllerFixture({
    weth9: weth9.address,
    hotpot: tokenHotPot.address,
    governance: (governance || wallets[0]).address,
    uniV3Router: uniV3Router.address,
    uniV3Factory: uniV3Factory.address
  }, wallets, provider)

  const { factory, positionLib } = await factoryFixture({
    controller: controller.address,
    weth9: weth9.address,
    uniV3Factory: uniV3Factory.address,
    uniV3Router: uniV3Router.address
  }, wallets, provider)

  const quoterFactory = await ethers.getContractFactory('Quoter')
  const quoter = (await quoterFactory.deploy(uniV3Factory.address, weth9.address)) as IQuoter

  const fundByteCode = (await ethers.getContractFactory('HotPotV2Fund', {
    libraries: {
      Position: positionLib
    }
  })).bytecode

  const tickMathFactory = await ethers.getContractFactory('TickMathTest')
  const tickMath = (await tickMathFactory.deploy()) as TickMathTest
  const testHarvestFactory = await ethers.getContractFactory('TestHarvest')
  const testHarvest = await testHarvestFactory.deploy(controller.address) as TestHarvest

  return {
    weth9,
    uniV3Factory,
    uniV3Router,
    tokens,
    tokenHotPot,
    nft,

    factory,
    controller,
    positionLib,
    fundByteCode,
    quoter,
    testHarvest,
    tickMath
  }
}

export default completeFixture
