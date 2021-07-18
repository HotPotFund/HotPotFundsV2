// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import './libraries/PathPrice.sol';
import './interfaces/IHotPotV2Fund.sol';
import './interfaces/IHotPot.sol';
import './interfaces/IHotPotV2FundController.sol';
import './base/Multicall.sol';

contract HotPotV2FundController is IHotPotV2FundController, Multicall {
    using Path for bytes;

    address public override immutable uniV3Factory;
    address public override immutable uniV3Router;
    address public override immutable hotpot;
    address public override governance;
    address public override immutable WETH9;
    uint public override maxHarvestSlippage = 20;//0-100

    mapping (address => bool) public override verifiedToken;
    mapping (address => bytes) public override harvestPath;

    modifier onlyManager(address fund){
        require(msg.sender == IHotPotV2Fund(fund).manager(), "OMC");
        _;
    }

    modifier onlyGovernance{
        require(msg.sender == governance, "OGC");
        _;
    }

    constructor(
        address _hotpot,
        address _governance,
        address _uniV3Router,
        address _uniV3Factory,
        address _weth9
    ) {
        hotpot = _hotpot;
        governance = _governance;
        uniV3Router = _uniV3Router;
        uniV3Factory = _uniV3Factory;
        WETH9 = _weth9;
    }

    /// @inheritdoc IGovernanceActions
    function setHarvestPath(address token, bytes memory path) external override onlyGovernance {
        bytes memory _path = path;
        while (true) {
            (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();

            // pool is exist
            address pool = IUniswapV3Factory(uniV3Factory).getPool(tokenIn, tokenOut, fee);
            require(pool != address(0), "PIE");
            // at least 2 observations
            (,,,uint16 observationCardinality,,,) = IUniswapV3Pool(pool).slot0();
            require(observationCardinality >= 2, "OC");

            if (path.hasMultiplePools()) {
                path = path.skipToken();
            } else {
                //最后一个交易对：输入WETH9, 输出hotpot
                require(tokenIn == WETH9 && tokenOut == hotpot, "IOT");
                break;
            }
        }
        harvestPath[token] = _path;
        emit SetHarvestPath(token, _path);
    }

    /// @inheritdoc IGovernanceActions
    function setMaxHarvestSlippage(uint slippage) external override onlyGovernance {
        require(slippage <= 100 ,"SMS");
        maxHarvestSlippage = slippage;
        emit SetMaxHarvestSlippage(slippage);
    }

    /// @inheritdoc IHotPotV2FundController
    function harvest(address token, uint amount) external override returns(uint burned) {
        uint value = amount <= IERC20(token).balanceOf(address(this)) ? amount : IERC20(token).balanceOf(address(this));
        TransferHelper.safeApprove(token, uniV3Router, value);

        uint curPirce = PathPrice.getSqrtPriceX96(harvestPath[token], uniV3Factory, true);
        uint lastPrice = PathPrice.getSqrtPriceX96(harvestPath[token], uniV3Factory, false);
        if(lastPrice > curPirce) {
            lastPrice = FullMath.mulDiv(lastPrice, lastPrice, FixedPoint96.Q96);
            require(FullMath.mulDiv(lastPrice - FullMath.mulDiv(curPirce, curPirce, FixedPoint96.Q96), 100, lastPrice) <= maxHarvestSlippage, "MHS");
        }
        
        ISwapRouter.ExactInputParams memory args = ISwapRouter.ExactInputParams({
            path: harvestPath[token],
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: value,
            amountOutMinimum: 0
        });
        burned = ISwapRouter(uniV3Router).exactInput(args);
        IHotPot(hotpot).burn(burned);
        emit Harvest(token, amount, burned);
    }

    /// @inheritdoc IGovernanceActions
    function setGovernance(address account) external override onlyGovernance {
        require(account != address(0));
        governance = account;
        emit SetGovernance(account);
    }

    /// @inheritdoc IGovernanceActions
    function setVerifiedToken(address token, bool isVerified) external override onlyGovernance {
        verifiedToken[token] = isVerified;
        emit ChangeVerifiedToken(token, isVerified);
    }

    /// @inheritdoc IManagerActions
    function setPath(
        address fund,
        address distToken,
        bytes memory path
    ) external override onlyManager(fund){
        require(verifiedToken[distToken]);

        address fundToken = IHotPotV2Fund(fund).token();
        bytes memory _path = path;
        bytes memory _reverse;
        (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();
        _reverse = abi.encodePacked(tokenOut, fee, tokenIn);
        bool isBuy;
        // 第一个tokenIn是基金token，那么就是buy路径
        if(tokenIn == fundToken){
            isBuy = true;
        }
        // 如果是sellPath, 第一个需要是目标代币
        else{
            require(tokenIn == distToken);
        }

        while (true) {
            require(verifiedToken[tokenIn], "VIT");
            require(verifiedToken[tokenOut], "VOT");
            // pool is exist
            address pool = IUniswapV3Factory(uniV3Factory).getPool(tokenIn, tokenOut, fee);
            require(pool != address(0), "PIE");
            // at least 2 observations
            (,,,uint16 observationCardinality,,,) = IUniswapV3Pool(pool).slot0();
            require(observationCardinality >= 2, "OC");

            if (path.hasMultiplePools()) {
                path = path.skipToken();
                (tokenIn, tokenOut, fee) = path.decodeFirstPool();
                _reverse = abi.encodePacked(tokenOut, fee, _reverse);
            } else {
                /// @dev 如果是buy, 最后一个token要是目标代币;
                /// @dev 如果是sell, 最后一个token要是基金token.
                if(isBuy)
                    require(tokenOut == distToken, "OID");
                else
                    require(tokenOut == fundToken, "OIF");
                break;
            }
        }
        emit SetPath(fund, distToken, _path);
        if(!isBuy) (_path, _reverse) = (_reverse, _path);
        IHotPotV2Fund(fund).setPath(distToken, _path, _reverse);
    }

    /// @inheritdoc IManagerActions
    function init(
        address fund,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint amount
    ) external override onlyManager(fund){
        IHotPotV2Fund(fund).init(token0, token1, fee, tickLower, tickUpper, amount);
    }

    /// @inheritdoc IManagerActions
    function add(
        address fund,
        uint poolIndex,
        uint positionIndex,
        uint amount,
        bool collect
    ) external override onlyManager(fund){
        IHotPotV2Fund(fund).add(poolIndex, positionIndex, amount, collect);
    }

    /// @inheritdoc IManagerActions
    function sub(
        address fund,
        uint poolIndex,
        uint positionIndex,
        uint proportionX128
    ) external override onlyManager(fund){
        IHotPotV2Fund(fund).sub(poolIndex, positionIndex, proportionX128);
    }

    /// @inheritdoc IManagerActions
    function move(
        address fund,
        uint poolIndex,
        uint subIndex,
        uint addIndex,
        uint proportionX128
    ) external override onlyManager(fund){
        IHotPotV2Fund(fund).move(poolIndex, subIndex, addIndex, proportionX128);
    }
}
