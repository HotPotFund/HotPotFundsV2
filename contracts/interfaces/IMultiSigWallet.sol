// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title MultiSigWallet 接口
interface IMultiSigWallet {    
    /// @notice 执行一笔多签交易时，触发该事件
    event MultiTransact(address owner, uint txId, uint value, address to, bytes data);
    
     /// @notice 创建完一笔还需要签名的交易时，触发该事件
    event ConfirmationNeeded(uint txId, address initiator, uint value, address to, bytes data);


    /// @notice 查询某个pending交易的数据
    /// @param txId 交易索引号
     function txsOf(uint txId) external view returns(
        address to,
        uint value,
        bytes memory data
    );


    /// @notice 创建待签名的交易
    /// @dev This function can only be called by owner
    /// @param to 目标地址
    /// @param value eth数量
    /// @param data 调用目标方法的msg.data
    /// @return txId 交易号
    function execute(address to, uint value, bytes memory data) external returns (uint txId);

    /// @notice 签名pending交易
    /// @dev This function can only be called by owner
    /// @param txId 交易号
    /// @return success 是否执行成功
    function confirm(uint txId) external returns (bool success);
}
