// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;


/// @title MultiOwned 事件接口定义
interface IMultiOwnedEvents {
    /// @notice 签名时，触发该事件
    event Confirmation(address owner, uint txId);

    /// @notice 撤销签名时触发该事件
    event Revoke(address owner, uint txId);

    /// @notice owner移交时，触发该事件
    event OwnerChanged(address oldOwner, address newOwner);

    /// @notice 添加新的owner时，触发该事件
    event OwnerAdded(address newOwner);

    /// @notice 移除owner时，触发该事件
    event OwnerRemoved(address oldOwner);

    /// @notice 最小签名数量发生改变时，触发该事件
    event RequirementChanged(uint newRequirement);
}
