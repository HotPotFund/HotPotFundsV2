// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;


/// @title MultiOwned 状态变量及只读函数
interface IMultiOwnedState {
    /// @notice 最小需要的签名数量
    function requiredNum() external view returns(uint);

    /// @notice 所有owner个数
    function ownerNums() external view returns(uint);

    /// @notice 查询某个pending交易的状态
    /// @param txId 交易索引号
    /// @return yetNeeded 还需要签名的数量, ownersDone 已经签名的owners;
    function pendingOf(uint txId) external view returns(uint yetNeeded, uint ownersDone);

    /// @notice 下一个pending队列交易号
    function nextPendingTxId() external view returns(uint);

    /// @notice 查询某个owner地址
    /// @dev Gets an owner by 0-indexed position (using numOwners as the count)
    function getOwner(uint ownerIndex) external view returns (address);

    /// @notice 地址是否为owner
    function isOwner(address addr) external view returns (bool);
    
    /// @notice owner是否已经签名交易
    /// @param txId 交易索引号
    /// @param owner owner地址
    function hasConfirmed(uint txId, address owner) external view returns (bool);
}