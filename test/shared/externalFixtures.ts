import UniswapV3FactoryAbi from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import { Fixture } from 'ethereum-waffle'
import { ethers, waffle } from 'hardhat'
import { IUniswapV3Factory, IWETH9, INonfungibleTokenPositionDescriptor, ISwapRouter } from '../../typechain'

import WETH9Abi from '../contracts/WETH9.json'
import { INonfungiblePositionManager } from '../../typechain/INonfungiblePositionManager'

const overrides = {
  gasLimit: 9999999
};

const wethFixture: Fixture<IWETH9> = async ([wallet]) => {
  return (await waffle.deployContract(wallet, WETH9Abi, [], overrides)) as IWETH9
}

const v3CoreFactoryFixture: Fixture<IUniswapV3Factory> = async ([wallet]) => {
  return (await waffle.deployContract(wallet, UniswapV3FactoryAbi, [], overrides)) as IUniswapV3Factory
}

export const v3RouterFixture: Fixture<{
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: ISwapRouter
}> = async ([wallet], provider) => {
  const weth9 = await wethFixture([wallet], provider)
  const factory = await v3CoreFactoryFixture([wallet], provider)

  const router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
    factory.address, weth9.address
  )) as ISwapRouter

  return { factory, weth9, router }
}


export const v3NftFixture: Fixture<{
  weth9: IWETH9
  factory: IUniswapV3Factory
  router: ISwapRouter
  nftDescriptor: INonfungibleTokenPositionDescriptor
  nft: INonfungiblePositionManager
}> = async ([wallet], provider) => {
  const {weth9, factory, router} = await v3RouterFixture([wallet], provider);

  const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor');
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy();
  const NonfungibleTokenPositionDescriptorFactory = await ethers.getContractFactory(
    'MockTimeNonfungiblePositionManager', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address
      }
    }
  );
  const nftDescriptor = (await NonfungibleTokenPositionDescriptorFactory.deploy(
    weth9.address
  )) as INonfungibleTokenPositionDescriptor

  const nft = (await (await ethers.getContractFactory('MockTimeNonfungiblePositionManager')).deploy(
    factory.address, weth9.address, nftDescriptor.address
  )) as INonfungiblePositionManager

  return { weth9, factory, router, nftDescriptor, nft }
}
