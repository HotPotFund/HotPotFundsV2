// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;

import './base/MultiOwned.sol';
import './interfaces/IMultiSigWallet.sol';


contract MultiSigWallet is IMultiSigWallet, MultiOwned {
    /// @inheritdoc IMultiSigWallet
    mapping (uint => Transaction) public override txsOf;

    struct Transaction {
        address to;
        uint value;
        bytes data;
    }

    constructor(address[] memory _owners, uint _required)
            MultiOwned(_owners, _required) {
    }
    
    function kill(address payable to) onlySelfCall external {
        selfdestruct(to);
    }

    receive() external payable {

    }
    
    /// @inheritdoc IMultiSigWallet
    function execute(address to, uint value, bytes memory data) override external returns (uint txId) {
        uint ownerIndex = ownerIndexOf[msg.sender];
        require(ownerIndex != 0, "OC");
        require(to != address(0), "EXT");

        if(requiredNum <= 1){
            (bool success, ) = to.call{value:value}(data);
            require(success, "EXC");
            emit MultiTransact(msg.sender, txId, value, to, data);
            return 0;
        }
        
        txId = nextPendingTxId;
        confirmAndCheck(txId, ownerIndex);
        txsOf[txId].to = to;
        txsOf[txId].value = value;
        txsOf[txId].data = data;
        emit ConfirmationNeeded(txId, msg.sender, value, to, data);
    }
    
    /// @inheritdoc IMultiSigWallet
    function confirm(uint txId) override external returns (bool success) {
        uint ownerIndex = ownerIndexOf[msg.sender];
        require(ownerIndex != 0, "OC");

        address to = txsOf[txId].to;
        uint value = txsOf[txId].value;
        bytes memory data = txsOf[txId].data;
        require(to != address(0), "TXI"); 
        if(!confirmAndCheck(txId, ownerIndex)) return true;

        (success, ) = to.call{value:value}(data);
        emit MultiTransact(msg.sender, txId, value, to, data);
        
        if (to != address(this)) delete txsOf[txId];
    }
    
    function clearPending() override internal {
        uint length = nextPendingTxId;
        for (uint i = 1; i < length; ++i)
            if (txsOf[i].to != address(0)) delete txsOf[i];
        super.clearPending();
    }
}