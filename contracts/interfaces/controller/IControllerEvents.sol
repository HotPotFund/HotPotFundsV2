// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;  

/// @title HotPotV2Controller 事件接口定义
interface IControllerEvents {
    /// @notice 当设置受信任token时触发
    event ChangeVerifiedToken(address indexed token, bool isVerified);

    /// @notice 当调用Harvest时触发
    event Harvest(address token, uint amount, uint burned);
}