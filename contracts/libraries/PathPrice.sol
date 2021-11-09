// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.7.5;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint128.sol";
import "./FixedPoint64.sol";
import '@uniswap/v3-core/contracts/libraries/TickMath.sol';
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "@uniswap/v3-periphery/contracts/libraries/Path.sol";

library PathPrice {
    using Path for bytes;

    /// @notice 根据设定的兑换路径，获取目标代币的价格平方根
    /// @param path 兑换路径
    /// @param priceType priceType & 0x1 > 0 获取预言机价格, priceType & 0x2 >0 获取当前价格，同时满足（如0x3）获取2种价格
    /// @return sqrtPriceX96Last sqrtPriceX96 价格的平方根(X 2^96)，给定兑换路径的 tokenOut / tokenIn 的价格
    // Supports priceX96 between TickMath.MIN_SQRT_RATIO and TickMath.MAX_SQRT_RATIO
    function getSqrtPriceX96(
        bytes memory path, 
        address uniV3Factory,
        uint8 priceType
    ) internal view returns (uint sqrtPriceX96Last, uint sqrtPriceX96){
        require(path.length > 0, "IPL");

        uint _sqrtPriceX96Last = FixedPoint96.Q96;
        uint _sqrtPriceX96 = FixedPoint96.Q96;
        uint _nextSqrtPriceX96;
        uint32[] memory secondAges = new uint32[](2);
        secondAges[0] = 0;
        secondAges[1] = 1;
        while (true) {
            (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();
            IUniswapV3Pool pool = IUniswapV3Pool(PoolAddress.computeAddress(uniV3Factory, PoolAddress.getPoolKey(tokenIn, tokenOut, fee)));

            // sqrtPriceX96Last
            if(priceType & 0x1 > 0) {
                (int56[] memory tickCumulatives,) = pool.observe(secondAges);
                _nextSqrtPriceX96 = TickMath.getSqrtRatioAtTick(int24(tickCumulatives[0] - tickCumulatives[1]));
                _sqrtPriceX96Last = tokenIn > tokenOut
                    ? FullMath.mulDiv(_sqrtPriceX96Last, FixedPoint96.Q96, _nextSqrtPriceX96)
                    : FullMath.mulDiv(_sqrtPriceX96Last, _nextSqrtPriceX96, FixedPoint96.Q96);
                require(_sqrtPriceX96Last >= TickMath.MIN_SQRT_RATIO, "R");
                require(_sqrtPriceX96Last < TickMath.MAX_SQRT_RATIO, "R");
            }

            // sqrtPriceX96
            if(priceType & 0x2 > 0) {
                (_nextSqrtPriceX96,,,,,,) = pool.slot0();
                _sqrtPriceX96 = tokenIn > tokenOut
                    ? FullMath.mulDiv(_sqrtPriceX96, FixedPoint96.Q96, _nextSqrtPriceX96)
                    : FullMath.mulDiv(_sqrtPriceX96, _nextSqrtPriceX96, FixedPoint96.Q96);
                require(_sqrtPriceX96 >= TickMath.MIN_SQRT_RATIO, "R");
                require(_sqrtPriceX96 < TickMath.MAX_SQRT_RATIO, "R");
            }

            // decide whether to continue or terminate
            if (path.hasMultiplePools())
                path = path.skipToken();
            else 
                return (_sqrtPriceX96Last, _sqrtPriceX96);
        }
    }

    /// @notice 验证交易滑点是否满足条件
    /// @param path 兑换路径
    /// @param uniV3Factory uniswap v3 factory
    /// @param maxSqrtSlippage 最大滑点,最大值: 1e4
    /// @return 当前价
    function verifySlippage(
        bytes memory path, 
        address uniV3Factory, 
        uint32 maxSqrtSlippage
    ) internal view returns(uint) { 
        (uint last, uint current) = getSqrtPriceX96(path, uniV3Factory, 0x3);
        if(last > current) require(current > maxSqrtSlippage * last / 1e4, "VS");//16bit * 160bit / 16bit 不会溢出
        return current;
    }
}
