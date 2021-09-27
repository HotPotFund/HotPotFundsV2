import {MultiSigWallet} from "../../typechain/MultiSigWallet";
import {ERC20Mock} from "../../typechain/ERC20Mock";
import {MockProvider} from 'ethereum-waffle'
import {ethers} from 'hardhat'
import {constants, Wallet} from 'ethers'


export interface MultiSigWalletFixture {
    token: ERC20Mock
    multiSigWallet: MultiSigWallet,
}

async function multiSigWalletFixture(wallets: Wallet[],
                                     provider: MockProvider): Promise<MultiSigWalletFixture> {

    const erc20Factory = await ethers.getContractFactory('ERC20Mock');
    const token = (await erc20Factory.deploy(constants.MaxUint256.div(1e2), 'DAI-TS', 'DAI', 18)) as ERC20Mock;

    const multiSigWalletFactory = await ethers.getContractFactory('MultiSigWallet');
    const multiSigWallet = (await multiSigWalletFactory.deploy(
        [wallets[1].address], 2
    )) as MultiSigWallet;

    return {
        token,
        multiSigWallet,
    }
}

export default multiSigWalletFixture
