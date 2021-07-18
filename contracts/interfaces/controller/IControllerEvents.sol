// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title HotPotV2Controller 事件接口定义
interface IControllerEvents {
    /// @notice 当设置受信任token时触发
    event ChangeVerifiedToken(address indexed token, bool isVerified);

    /// @notice 当调用Harvest时触发
    event Harvest(address indexed token, uint amount, uint burned);

    /// @notice 当调用setHarvestPath时触发
    event SetHarvestPath(address indexed token, bytes path);

    /// @notice 当调用setGovernance时触发
    event SetGovernance(address indexed account);

    /// @notice 当调用setPath时触发
    event SetPath(address indexed fund, address indexed distToken, bytes path);

    /// @notice 当调用setMaxHarvestSlippage时触发
    event SetMaxHarvestSlippage(uint slippage);
}
