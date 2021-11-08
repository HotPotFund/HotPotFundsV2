// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '../interfaces/IHotPotV2FundController.sol';
import '../interfaces/IHotPotV2Fund.sol';

contract TestSwapSlippage{
    address public controller;
    constructor(address ctrl) {
        controller = ctrl;
    }

    receive() external payable {}

    function harvest(address token, uint amount, uint swapAmount, address csToken, bytes memory path) external returns(uint burned){
        IHotPotV2FundController ctrl = IHotPotV2FundController(controller);
        address uniV3Router = ctrl.uniV3Router();

        // change slippage
        TransferHelper.safeApprove(csToken, uniV3Router, swapAmount);
        ISwapRouter.ExactInputParams memory args = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: swapAmount,
            amountOutMinimum: 0
        });
        ISwapRouter(uniV3Router).exactInput(args);

        // harvest
        return ctrl.harvest(token, amount);
    }

    function withdraw(
        address token, uint swapAmount, bytes memory path,
        address fund, uint share, uint amountMIn
    ) external returns(uint burned){
        IHotPotV2FundController ctrl = IHotPotV2FundController(controller);
        address uniV3Router = ctrl.uniV3Router();
        TransferHelper.safeApprove(token, uniV3Router, swapAmount);

        // change slippage
        ISwapRouter.ExactInputParams memory args = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: swapAmount,
            amountOutMinimum: 0
        });
        ISwapRouter(uniV3Router).exactInput(args);

        // withdraw
        return IHotPotV2Fund(fund).withdraw(share, amountMIn, block.timestamp);
    }
}
