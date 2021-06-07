// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import './interfaces/IHotPotV2FundDeployer.sol';
import './HotPotV2Fund.sol';

contract HotPotV2FundDeployer is IHotPotV2FundDeployer {
    struct Parameters {
        address WETH9;
        address uniswapV3Factory;
        address uniswapV3Router;
        address controller;
        address manager;
        address token;
        bytes32 descriptor;
    }

    /// @inheritdoc IHotPotV2FundDeployer
    Parameters public override parameters;

    /// @dev Deploys a fund with the given parameters by transiently setting the parameters storage slot and then
    /// clearing it after deploying the fund.
    /// @param controller The controller address
    /// @param manager The manager address of this fund
    /// @param token The local token address
    /// @param descriptor 32 bytes string descriptor, 8 bytes manager name + 24 bytes brief description
    function deploy(
        address WETH9,
        address uniswapV3Factory,
        address uniswapV3Router,
        address controller,
        address manager,
        address token,
        bytes32 descriptor
    ) internal returns (address fund) {
        parameters = Parameters({
            WETH9: WETH9,
            uniswapV3Factory: uniswapV3Factory,
            uniswapV3Router: uniswapV3Router,
            controller: controller,
            manager: manager,
            token: token, 
            descriptor: descriptor
        });

        fund = address(new HotPotV2Fund{salt: keccak256(abi.encode(manager, token))}());
        delete parameters;
    }
}
