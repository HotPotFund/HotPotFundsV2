// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title HotPotV2Controller 状态变量及只读函数
interface IControllerState {
    /// @notice Returns the address of the Uniswap V3 router
    function uniV3Router() external view returns (address);

    /// @notice Returns the address of the Uniswap V3 facotry
    function uniV3Factory() external view returns (address);

    /// @notice 本项目治理代币HPT的地址
    function hotpot() external view returns (address);

    /// @notice 治理账户地址
    function governance() external view returns (address);

    /// @notice Returns the address of WETH9
    function WETH9() external view returns (address);

    /// @notice 代币是否受信任
    /// @dev The call will revert if the the token argument is address 0.
    /// @param token 要查询的代币地址
    function verifiedToken(address token) external view returns (bool);

    /// @notice harvest时交易路径
    /// @param token 要兑换的代币
    function harvestPath(address token) external view returns (bytes memory);

    /// @notice 涉及到swap时最大滑点 0-1e4，这里是sqrt值
    function maxSqrtSlippage() external view returns (uint16);

    /// @notice 涉及到swap时最大价格影响 0-1e4
    function maxPriceImpact() external view returns (uint16);
}
