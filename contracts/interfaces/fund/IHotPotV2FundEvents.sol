// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Hotpot V2 事件接口定义
interface IHotPotV2FundEvents {
    /// @notice 当存入基金token时，会触发该事件
    event Deposit(address indexed owner, uint amount, uint share);

    /// @notice 当取走基金token时，会触发该事件
    event Withdraw(address indexed owner, uint amount, uint share);
}
