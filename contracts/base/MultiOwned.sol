// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;

import '../interfaces/IMultiOwned.sol';


contract MultiOwned is IMultiOwned {
    /// @inheritdoc IMultiOwnedState
    uint public override requiredNum;
    /// @inheritdoc IMultiOwnedState
    uint public override ownerNums;
    
    // list of owners
    uint public constant MAX_OWNERS = 16;
    address[MAX_OWNERS + 1] owners;
    mapping(address => uint) ownerIndexOf;

    /// @inheritdoc IMultiOwnedState
    mapping(uint => PendingState) public override pendingOf;
    /// @inheritdoc IMultiOwnedState
    uint public override nextPendingTxId = 1;

    struct PendingState {
        uint yetNeeded;
        uint ownersDone;
    }

    // self call function modifier.
    modifier onlySelfCall() {
        require(msg.sender == address(this), "OSC");
        _;
    }

    constructor(address[] memory _owners, uint _required) {
        uint nums = _owners.length + 1;
        require(MAX_OWNERS >= nums, "MAX");
        require(_required <= nums && _required > 0, "REQ");
        
        ownerNums = nums;
        owners[1] = msg.sender;
        ownerIndexOf[msg.sender] = 1;
        for (uint i = 0; i < _owners.length; ++i) {
            require(_owners[i] != address(0), "ZA");
            require(!isOwner(_owners[i]), "ISO");
            owners[2 + i] = _owners[i];
            ownerIndexOf[_owners[i]] = 2 + i;
        }
        requiredNum = _required;
    }
    
    /// @inheritdoc IMultiOwnedActions
    function revoke(uint txId) external override {
        uint ownerIndex = ownerIndexOf[msg.sender];
        require(ownerIndex != 0, "OC");

        uint ownerIndexBit = 2**ownerIndex;
        PendingState storage pending = pendingOf[txId];
        require(pending.ownersDone & ownerIndexBit > 0, "OD");

        pending.yetNeeded++;
        pending.ownersDone -= ownerIndexBit;
        emit Revoke(msg.sender, txId);
    }
    

    /// @inheritdoc IMultiOwnedActions
    function changeOwner(address from, address to) onlySelfCall external override {
        uint ownerIndex = ownerIndexOf[from];
        require(ownerIndex > 0, "COF");
        require(!isOwner(to) && to != address(0), "COT");

        clearPending();
        owners[ownerIndex] = to;
        ownerIndexOf[from] = 0;
        ownerIndexOf[to] = ownerIndex;
        emit OwnerChanged(from, to);
    }
    
    /// @inheritdoc IMultiOwnedActions
    function addOwner(address newOwner) onlySelfCall external override {
        require(!isOwner(newOwner), "AON");
        require(ownerNums < MAX_OWNERS, "AOM");
        
        clearPending();
        ownerNums++;
        owners[ownerNums] = newOwner;
        ownerIndexOf[newOwner] = ownerNums;
        emit OwnerAdded(newOwner);
    }
    
    /// @inheritdoc IMultiOwnedActions
    function removeOwner(address owner) onlySelfCall external override {
        uint ownerIndex = ownerIndexOf[owner];
        require(ownerIndex > 0, "ROI");
        require(requiredNum <= ownerNums - 1, "RON");

        owners[ownerIndex] = address(0);
        ownerIndexOf[owner] = 0;
        clearPending();
        reorganizeOwners(); 
        emit OwnerRemoved(owner);
    }
    
    /// @inheritdoc IMultiOwnedActions
    function changeRequirement(uint newRequired) onlySelfCall external override {
        require(newRequired <= ownerNums && newRequired > 0, "CR");

        requiredNum = newRequired;
        clearPending();
        emit RequirementChanged(newRequired);
    }

    /// @inheritdoc IMultiOwnedState
    function getOwner(uint ownerIndex) external override view returns (address) {
        return address(owners[ownerIndex + 1]);
    }

    /// @inheritdoc IMultiOwnedState
    function isOwner(address addr) public override view returns (bool) {
        return ownerIndexOf[addr] > 0;
    }
    
    /// @inheritdoc IMultiOwnedState
    function hasConfirmed(uint txId, address owner) external override view returns (bool) {
        PendingState storage pending = pendingOf[txId];
        uint ownerIndex = ownerIndexOf[owner];
        if (ownerIndex == 0) return false;
        
        // determine the bit to set for this owner.
        uint ownerIndexBit = 2**ownerIndex;
        return (pending.ownersDone & ownerIndexBit > 0);
    }
    

    function confirmAndCheck(uint txId, uint ownerIndex) internal returns (bool) {
        PendingState storage pending = pendingOf[txId];
        // if we're not yet working on this operation, switch over and reset the confirmation status.
        if (pending.yetNeeded == 0) {
            // reset count of confirmations needed.
            pending.yetNeeded = requiredNum;
            // reset which owners have confirmed (none) - set our bitmap to 0.
            pending.ownersDone = 0;
            nextPendingTxId = txId + 1;
        }
        // determine the bit to set for this owner.
        uint ownerIndexBit = 2**ownerIndex;
        // make sure we (the message sender) haven't confirmed this operation previously.
        if (pending.ownersDone & ownerIndexBit == 0) {
            emit Confirmation(msg.sender, txId);
            // ok - check if count is enough to go ahead.
            if (pending.yetNeeded <= 1) {
                // enough confirmations: reset and run interior.
                delete pendingOf[txId];
                return true;
            } else {
                // not enough: record that this owner in particular confirmed.
                pending.yetNeeded--;
                pending.ownersDone |= ownerIndexBit;
            }
        }
        return false;
    }

    function reorganizeOwners() private {
        uint free = 1;
        while (free < ownerNums) {
            while (free < ownerNums && owners[free] != address(0)) free++;
            while (ownerNums > 1 && owners[ownerNums] == address(0)) ownerNums--;
            if (free < ownerNums && owners[ownerNums] != address(0) && owners[free] == address(0)) {
                owners[free] = owners[ownerNums];
                ownerIndexOf[owners[free]] = free;
                owners[ownerNums] = address(0);
            }
        }
    }
    
    function clearPending() virtual internal {
        uint length = nextPendingTxId;
        for (uint i = 1; i < length; ++i)
            if (pendingOf[i].yetNeeded != 0) delete pendingOf[i];
        nextPendingTxId = 1;
    }
}