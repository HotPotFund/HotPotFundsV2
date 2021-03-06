// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title The interface for the HotPotFunds V2 Factory
/// @notice The HotPotFunds V2 Factory facilitates creation of HotPotFunds V2 funds
interface IHotPotV2FundFactory {
    /// @notice Emitted when a fund is created
    /// @param manager The manager address of fund
    /// @param token Deposit or withdrawal token supported by the fund
    /// @param fund The fund is created
    event FundCreated(
        address indexed manager,
        address indexed token,
        address indexed fund
    );

    /// @notice Returns the address of WETH9
    function WETH9() external view returns (address);

    /// @notice Returns the address of the Uniswap V3 factory
    function uniV3Factory() external view returns (address);

    /// @notice Returns the address of the Uniswap V3 router
    function uniV3Router() external view returns (address);

    /// @notice fund controller
    function controller() external view returns(address);

    /// @notice Returns the fund address for a given manager and a token, or address 0 if it does not exist
    /// @dev a manager+token mapping a fund
    /// @param manager 管理基金的经理地址
    /// @param token 管理的代币
    /// @return fund 基金地址
    function getFund(address manager, address token) external view returns (address fund);

    /// @notice Creates a fund for the given manager and token
    // / @param manager 基金的manager
    /// @param token 管理的token
    /// @param descriptor 基金名称+描述
    /// @return fund 基金地址
    function createFund(address token, bytes32 descriptor) external returns (address fund);
}
