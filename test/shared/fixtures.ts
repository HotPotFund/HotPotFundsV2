import { BigNumber, constants, Contract, Wallet } from 'ethers'
import { expandTo18Decimals, expandTo6Decimals } from './utils'
import { FeeAmount } from './constants'
import { expect } from 'chai'


export const INIT_FOR_TEST_WETH_AMOUNT = expandTo18Decimals(0.4 * 1e4);//cannot be greater than 1e4
export const INIT_FOR_TEST_TOKEN_AMOUNT_18 = expandTo18Decimals(1e3 * 1e4);
export const INIT_FOR_TEST_TOKEN_AMOUNT_6 = expandTo6Decimals(1e3 * 1e4);
export const INIT_PAIR_LP_AMOUNT_18 = expandTo18Decimals(1e3);
export const INIT_PAIR_LP_AMOUNT_6 = expandTo6Decimals(1e3);
export const DEFAULT_FEE = FeeAmount.MEDIUM;



export async function printPairsStatus(hotPotFund: Contract) {
    const length = (await hotPotFund.pairsLength()).toNumber();
    for (let i = 0; i < length; i++) {
        console.log(`pair_${i}:${await hotPotFund.pairs(i)}`);
    }
}

export interface ContractCaseBuilder {
    target: Contract;
    caseData: {
        [item: string]: {
            args?: any;
            symbol?: any,
            value: any;
        } | Array<{
            args?: any;
            symbol?: any,
            value: any;
        }>
    };
}

export function readStatus(builder: () => ContractCaseBuilder) {
    return async () => {
        const {target, caseData} = await builder();
        const keys = Object.keys(caseData);
        for (const key of keys) {
            if (Array.isArray(caseData[key])) {
                for (let child of caseData[key] as any) {
                    if (child.args) {
                        // @ts-ignore
                        await expect(await target[key](...child.args)).to[child.symbol ? child.symbol : "eq"](child.value)
                    } else {
                        // @ts-ignore
                        await expect(await target[key]()).to[child.symbol ? child.symbol : "eq"](child.value)
                    }
                }
            }
            // @ts-ignore
            else if (caseData[key].args) {
                // @ts-ignore
                await expect(await target[key](...caseData[key].args)).to[caseData[key].symbol ? caseData[key].symbol : "eq"](caseData[key].value)
            } else {
                // @ts-ignore
                await expect(await target[key]()).to[caseData[key].symbol ? caseData[key].symbol : "eq"](caseData[key].value)
            }
        }
    }
}

export async function depositHotPotFund(hotPotFund: Contract, token: Contract, depositor: any, amount: BigNumber) {
    //approve hotPotFund transfer investing token
    await token.connect(depositor).approve(hotPotFund.address, 0);//must be clear for USDT
    await token.connect(depositor).approve(hotPotFund.address, constants.MaxUint256);
    //deposit investing token to hotPotFund
    await expect(hotPotFund.connect(depositor).deposit(amount)).to.not.be.reverted;
}

export async function depositHotPotFundETH(hotPotFund: Contract, depositor: any, amount: BigNumber) {
    //deposit investing ETH to hotPotFundETH
    await expect(hotPotFund.connect(depositor).deposit({value: amount})).to.not.be.reverted;
}

export async function mintAndDepositHotPotFund(hotPotFund: Contract, token: Contract, depositor: any, mintAmount: BigNumber, depositAmount?: BigNumber) {
    depositAmount = depositAmount ? depositAmount : mintAmount;
    // if (await token.symbol() != "WETH") {
        //mint token for testing
        // await token._mint_for_testing(depositor.address, mintAmount);
        await depositHotPotFund(hotPotFund, token, depositor, depositAmount);
    // } else {
    //     //mint token for testing
    //     await token.connect(depositor).deposit({value: mintAmount});
    //     //deposit INIT_DEPOSIT_AMOUNT ETH to hotPotFundETH for invest
    //     await depositHotPotFundETH(hotPotFund, depositor, depositAmount);
    // }
}
