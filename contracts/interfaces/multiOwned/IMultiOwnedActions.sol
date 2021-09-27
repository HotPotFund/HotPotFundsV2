// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;


/// @title MultiOwned 操作接口定义
interface IMultiOwnedActions {
    /// @notice 撤销某笔pending交易的签名
    /// @dev This function can only be called by owner
    /// @param txId 交易号
    function revoke(uint txId) external;

    /// @notice 修改owner为其它地址
    /// @dev This function can only be called by self
    /// @param from 源地址
    /// @param to 目标地址
    function changeOwner(address from, address to) external;

    /// @notice 添加新的owner
    /// @dev This function can only be called by self
    /// @param newOwner 新的owner地址
    function addOwner(address newOwner) external;

    /// @notice 移除owner
    /// @dev This function can only be called by self
    /// @param owner owner地址
    function removeOwner(address owner) external;

    /// @notice 修改最小签名数
    /// @dev This function can only be called by self
    /// @param newRequired 新的最小签名数
    function changeRequirement(uint newRequired) external;
}
