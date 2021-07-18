// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.5;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import '@uniswap/v3-core/contracts/libraries/TickMath.sol';
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "@uniswap/v3-periphery/contracts/libraries/Path.sol";

library PathPrice {
    using Path for bytes;

    /// @notice 根据设定的兑换路径，获取目标代币的价格平方根
    /// @param path 兑换路径
    /// @param isCurrentPrice 获取当前价格, 还是预言机价格
    /// @return sqrtPriceX96 价格的平方根(X 2^96)，给定兑换路径的 tokenOut / tokenIn 的价格
    function getSqrtPriceX96(
        bytes memory path, 
        address uniV3Factory,
        bool isCurrentPrice
    ) internal view returns (uint160 sqrtPriceX96){
        require(path.length > 0, "IPL");

        sqrtPriceX96 = uint160(1 << FixedPoint96.RESOLUTION);
        while (true) {
            (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();
            IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(uniV3Factory, PoolAddress.getPoolKey(tokenIn, tokenOut, fee)));

            uint160 _sqrtPriceX96;
            if(isCurrentPrice){
                (_sqrtPriceX96,,,,,,) = pool.slot0();
            } else {
                uint32[] memory secondAges= new uint32[](2);
                secondAges[0] = 0;
                secondAges[1] = 1;
                (int56[] memory tickCumulatives,) = pool.observe(secondAges);
                _sqrtPriceX96 = TickMath.getSqrtRatioAtTick(int24(tickCumulatives[0] - tickCumulatives[1]));
            }
            
            sqrtPriceX96 = uint160(
                tokenIn > tokenOut
                ? FullMath.mulDiv(sqrtPriceX96, FixedPoint96.Q96, _sqrtPriceX96)
                : FullMath.mulDiv(sqrtPriceX96, _sqrtPriceX96, FixedPoint96.Q96)
            );

            // decide whether to continue or terminate
            if (path.hasMultiplePools())
                path = path.skipToken();
            else
                return sqrtPriceX96;
        }
    }
}
