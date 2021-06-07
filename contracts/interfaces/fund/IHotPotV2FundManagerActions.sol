// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @notice 基金经理操作接口定义
interface IHotPotV2FundManagerActions {
    /// @notice 设置代币交易路径
    /// @dev This function can only be called by controller 
    /// @dev 设置路径时不能修改为0地址，且path路径里的token必须验证是否受信任
    /// @param distToken 目标代币地址
    /// @param buy 购买路径(本币->distToken)
    /// @param sell 销售路径(distToken->本币)
    function setPath(
        address distToken, 
        bytes memory buy,
        bytes memory sell
    ) external;

    /// @notice 初始化头寸, 允许投资额为0.
    /// @dev This function can only be called by controller
    /// @param token0 token0 地址
    /// @param token1 token1 地址
    /// @param fee 手续费率
    /// @param tickLower 价格刻度下届
    /// @param tickUpper 价格刻度上届
    /// @param amount 初始化投入金额，允许为0, 为0表示仅初始化头寸，不作实质性投资
    function init(
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint amount
    ) external;

    /// @notice 投资指定头寸，可选复投手续费
    /// @dev This function can only be called by controller 
    /// @param poolIndex 池子索引号
    /// @param positionIndex 头寸索引号
    /// @param amount 投资金额
    /// @param collect 是否收集已产生的手续费并复投
    function add(
        uint poolIndex, 
        uint positionIndex, 
        uint amount, 
        bool collect
    ) external;

    /// @notice 撤资指定头寸
    /// @dev This function can only be called by controller 
    /// @param poolIndex 池子索引号
    /// @param positionIndex 头寸索引号
    /// @param proportionX128 撤资比例，左移128位; 允许为0，为0表示只收集手续费
    function sub(
        uint poolIndex, 
        uint positionIndex, 
        uint proportionX128
    ) external;

    /// @notice 调整头寸投资
    /// @dev This function can only be called by controller 
    /// @param poolIndex 池子索引号
    /// @param subIndex 要移除的头寸索引号
    /// @param addIndex 要添加的头寸索引号
    /// @param proportionX128 调整比例，左移128位
    function move(
        uint poolIndex,
        uint subIndex, 
        uint addIndex, 
        uint proportionX128 //以前是按LP数量移除，现在改成按总比例移除，这样前端就不用管实际LP是多少了
    ) external;
}
