// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title An interface for a contract that is capable of deploying Hotpot V2 Funds
/// @notice A contract that constructs a fund must implement this to pass arguments to the fund
/// @dev This is used to avoid having constructor arguments in the fund contract, which results in the init code hash
/// of the fund being constant allowing the CREATE2 address of the fund to be cheaply computed on-chain
interface IHotPotV2FundDeployer {
    /// @notice Get the parameters to be used in constructing the fund, set transiently during fund creation.
    /// @dev Called by the fund constructor to fetch the parameters of the fund
    /// Returns controller The controller address
    /// Returns manager The manager address of this fund
    /// Returns token The local token address
    /// Returns descriptor 32 bytes string descriptor, 8 bytes manager name + 24 bytes brief description
    function parameters()
        external
        view
        returns (
            address weth9,
            address uniV3Factory,
            address uniswapV3Router,
            address controller,
            address manager,
            address token,
            bytes32 descriptor
        );
}
