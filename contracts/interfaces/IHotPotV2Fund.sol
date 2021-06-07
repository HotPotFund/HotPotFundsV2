// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './IHotPotV2FundERC20.sol';
import './fund/IHotPotV2FundEvents.sol';
import './fund/IHotPotV2FundState.sol';
import './fund/IHotPotV2FundUserActions.sol';
import './fund/IHotPotV2FundManagerActions.sol';

/// @title Hotpot V2 基金接口
/// @notice 接口定义分散在多个接口文件
interface IHotPotV2Fund is 
    IHotPotV2FundERC20, 
    IHotPotV2FundEvents, 
    IHotPotV2FundState, 
    IHotPotV2FundUserActions, 
    IHotPotV2FundManagerActions
{    
}
