// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import './multiOwned/IMultiOwnedEvents.sol';
import './multiOwned/IMultiOwnedState.sol';
import './multiOwned/IMultiOwnedActions.sol';

/// @title MultiOwned接口
/// @notice 接口定义分散在多个接口文件
interface IMultiOwned is 
    IMultiOwnedEvents, 
    IMultiOwnedState, 
    IMultiOwnedActions
{    
}
