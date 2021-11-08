// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.7.6;
pragma abicoder v2;

import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/libraries/TickMath.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@uniswap/v3-core/contracts/libraries/FixedPoint128.sol";
import "@uniswap/v3-core/contracts/libraries/SqrtPriceMath.sol";
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import '@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol';
import '@uniswap/v3-periphery/contracts/libraries/PositionKey.sol';
import "@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol";
import "@uniswap/v3-periphery/contracts/libraries/Path.sol";
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import './interfaces/IHotPotV2FundDeployer.sol';
import './interfaces/IHotPotV2Fund.sol';
import './interfaces/external/IWETH9.sol';
import './base/HotPotV2FundERC20.sol';
import './libraries/Position.sol';
import './libraries/Array2D.sol';

contract HotPotV2Fund is HotPotV2FundERC20, IHotPotV2Fund, IUniswapV3MintCallback, ReentrancyGuard {
    using LowGasSafeMath for uint;
    using SafeCast for int256;
    using Path for bytes;
    using Position for Position.Info;
    using Position for Position.Info[];
    using Array2D for uint[][];

    uint constant DIVISOR = 100 << 128;
    uint constant MANAGER_FEE = 10 << 128;
    uint constant FEE = 10 << 128;

    address immutable WETH9;
    address immutable uniV3Factory;
    address immutable uniV3Router;

    address public override immutable controller;
    address public override immutable manager;
    address public override immutable token;
    bytes32 public override descriptor;

    uint public override totalInvestment;

    /// @inheritdoc IHotPotV2FundState
    mapping (address => uint) override public investmentOf;

    /// @inheritdoc IHotPotV2FundState
    mapping(address => bytes) public override buyPath;
    /// @inheritdoc IHotPotV2FundState
    mapping(address => bytes) public override sellPath;

    /// @inheritdoc IHotPotV2FundState
    address[] public override pools;
    /// @inheritdoc IHotPotV2FundState
    Position.Info[][] public override positions;

    modifier onlyController() {
        require(msg.sender == controller, "OCC");
        _;
    }

    modifier checkDeadline(uint deadline) {
        require(block.timestamp <= deadline, 'CDL');
        _;
    }

    constructor () {
        address _token;
        address _uniV3Router;
        (WETH9, uniV3Factory, _uniV3Router, controller, manager, _token, descriptor) = IHotPotV2FundDeployer(msg.sender).parameters();
        token = _token;
        uniV3Router = _uniV3Router;

        //approve for add liquidity and swap. 2**256-1 never used up.
        TransferHelper.safeApprove(_token, _uniV3Router, 2**256-1);
    }

    /// @inheritdoc IHotPotV2FundUserActions
    function deposit(uint amount) external override returns(uint share) {
        require(amount > 0, "DAZ");
        uint total_assets = totalAssets();
        TransferHelper.safeTransferFrom(token, msg.sender, address(this), amount);

        return _deposit(amount, total_assets);
    }

    function _deposit(uint amount, uint total_assets) internal returns(uint share) {
        if(totalSupply == 0)
            share = amount;
        else
            share =  FullMath.mulDiv(amount, totalSupply, total_assets);

        investmentOf[msg.sender] = investmentOf[msg.sender].add(amount);
        totalInvestment = totalInvestment.add(amount);
        _mint(msg.sender, share);
        emit Deposit(msg.sender, amount, share);
    }

    receive() external payable {
        //当前是WETH9基金
        if(token == WETH9){
            // 普通用户发起的转账ETH，认为是deposit
            if(msg.sender != WETH9 && msg.value > 0){
                uint totals = totalAssets();
                IWETH9(WETH9).deposit{value: address(this).balance}();
                _deposit(msg.value, totals);
            } //else 接收WETH9向合约转账ETH
        }
        // 不是WETH基金, 不接受ETH转账
        else revert();
    }

    /// @inheritdoc IHotPotV2FundUserActions
    function withdraw(uint share, uint amountMin, uint deadline) external override checkDeadline(deadline) nonReentrant returns(uint amount) {
        uint balance = balanceOf[msg.sender];
        require(share > 0 && share <= balance, "ISA");
        uint investment = FullMath.mulDiv(investmentOf[msg.sender], share, balance);

        address fToken = token;
        // 构造amounts数组
        uint value = IERC20(fToken).balanceOf(address(this));
        uint _totalAssets = value;
        uint[][] memory amounts = new uint[][](pools.length);
        for(uint i=0; i<pools.length; i++){
            uint _amount;
            (_amount, amounts[i]) = _assetsOfPool(i);
            _totalAssets = _totalAssets.add(_amount);
        }

        amount = FullMath.mulDiv(_totalAssets, share, totalSupply);
        // 从大到小从头寸中撤资.
        if(amount > value) {
            uint remainingAmount = amount.sub(value);
            while(true) {
                // 取最大的头寸索引号
                (uint poolIndex, uint positionIndex, uint desirableAmount) = amounts.max();
                if(desirableAmount == 0) break;

                if(remainingAmount <= desirableAmount){
                    positions[poolIndex][positionIndex].subLiquidity(Position.SubParams({
                        proportionX128: FullMath.mulDiv(remainingAmount, DIVISOR, desirableAmount),
                        pool: pools[poolIndex],
                        token: fToken,
                        uniV3Router: uniV3Router,
                        uniV3Factory: uniV3Factory,
                        maxSqrtSlippage: 10001,
                        maxPriceImpact: 10001
                    }), sellPath);
                    break;
                }
                else {
                    positions[poolIndex][positionIndex].subLiquidity(Position.SubParams({
                            proportionX128: DIVISOR,
                            pool: pools[poolIndex],
                            token: fToken,
                            uniV3Router: uniV3Router,
                            uniV3Factory: uniV3Factory,
                            maxSqrtSlippage: 10001,
                            maxPriceImpact: 10001
                        }), sellPath);
                    remainingAmount = remainingAmount.sub(desirableAmount);
                    amounts[poolIndex][positionIndex] = 0;
                }
            }
            /// @dev 从流动池中撤资时，按比例撤流动性, 同时tokensOwed已全部提取，所以此时的基金本币余额会超过用户可提金额.
            value = IERC20(fToken).balanceOf(address(this));
            // 如果计算值比实际取出值大
            if(amount > value)
                amount = value;
            // 如果是最后一个人withdraw
            else if(totalSupply == share)
                amount = value;
        }
        require(amount >= amountMin, 'PSC');

        // 处理基金经理分成和基金分成
        if(amount > investment){
            uint _manager_fee = FullMath.mulDiv(amount.sub(investment), MANAGER_FEE, DIVISOR);
            uint _fee = FullMath.mulDiv(amount.sub(investment), FEE, DIVISOR);
            TransferHelper.safeTransfer(fToken, manager, _manager_fee);
            TransferHelper.safeTransfer(fToken, controller, _fee);
            amount = amount.sub(_fee).sub(_manager_fee);
        }
        else
            investment = amount;

        // 处理转账
        investmentOf[msg.sender] = investmentOf[msg.sender].sub(investment);
        totalInvestment = totalInvestment.sub(investment);
        _burn(msg.sender, share);

        if(fToken == WETH9){
            IWETH9(WETH9).withdraw(amount);
            TransferHelper.safeTransferETH(msg.sender, amount);
        } else {
            TransferHelper.safeTransfer(fToken, msg.sender, amount);
        }

        emit Withdraw(msg.sender, amount, share);
    }

    /// @inheritdoc IHotPotV2FundState
    function poolsLength() external override view returns(uint){
        return pools.length;
    }

    /// @inheritdoc IHotPotV2FundState
    function positionsLength(uint poolIndex) external override view returns(uint){
        return positions[poolIndex].length;
    }

    /// @inheritdoc IHotPotV2FundManagerActions
    function setPath(
        address distToken,
        bytes memory buy,
        bytes memory sell
    ) external override onlyController{
        // 要修改sellPath, 需要先清空相关pool头寸资产
        if(sellPath[distToken].length > 0){
            for(uint i = 0; i < pools.length; i++){
                IUniswapV3Pool pool = IUniswapV3Pool(pools[i]);
                if(pool.token0() == distToken || pool.token1() == distToken){
                    (uint amount,) = _assetsOfPool(i);
                    require(amount == 0, "AZ");
                }
            }
        }
        TransferHelper.safeApprove(distToken, uniV3Router, 0);
        TransferHelper.safeApprove(distToken, uniV3Router, 2**256-1);
        buyPath[distToken] = buy;
        sellPath[distToken] = sell;
    }

    /// @inheritdoc IUniswapV3MintCallback
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external override {
        address pool = pools[abi.decode(data, (uint))];
        require(msg.sender == pool, "MQE");

        // 转账给pool
        if (amount0Owed > 0) TransferHelper.safeTransfer(IUniswapV3Pool(pool).token0(), msg.sender, amount0Owed);
        if (amount1Owed > 0) TransferHelper.safeTransfer(IUniswapV3Pool(pool).token1(), msg.sender, amount1Owed);
    }

    /// @inheritdoc IHotPotV2FundManagerActions
    function init(
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint amount,
        uint maxPIS
    ) external override onlyController returns(uint128 liquidity){
        // 1、检查pool是否有效
        require(tickLower < tickUpper, "ITV");
        require(token0 < token1, "ITV");
        address pool = IUniswapV3Factory(uniV3Factory).getPool(token0, token1, fee);
        require(pool != address(0), "ITF");
        int24 tickspacing = IUniswapV3Pool(pool).tickSpacing();
        require(tickLower % tickspacing == 0, "TLV");
        require(tickUpper % tickspacing == 0, "TUV");

        // 2、添加流动池
        bool hasPool = false;
        uint poolIndex;
        for(uint i = 0; i < pools.length; i++){
            // 存在相同的流动池
            if(pools[i] == pool) {
                hasPool = true;
                poolIndex = i;
                for(uint positionIndex = 0; positionIndex < positions[i].length; positionIndex++) {
                    // 存在相同的头寸, 退出
                    if(positions[i][positionIndex].tickLower == tickLower)
                        if(positions[i][positionIndex].tickUpper == tickUpper)
                            revert();
                }
                break;
            }
        }
        if(!hasPool) {
            pools.push(pool);
            positions.push();
            poolIndex = pools.length - 1;
        }

        //3、新增头寸
        positions[poolIndex].push(Position.Info({
            isEmpty: true,
            tickLower: tickLower,
            tickUpper: tickUpper
        }));

        //4、投资
        if(amount > 0){
            address fToken = token;
            require(IERC20(fToken).balanceOf(address(this)) >= amount, "ATL");
            Position.Info storage position = positions[poolIndex][positions[poolIndex].length - 1];
            liquidity = position.addLiquidity(Position.AddParams({
                poolIndex: poolIndex,
                pool: pool,
                amount: amount,
                amount0Max: 0,
                amount1Max: 0,
                token: fToken,
                uniV3Router: uniV3Router,
                uniV3Factory: uniV3Factory,
                maxSqrtSlippage: uint16(maxPIS & 0xffff),
                maxPriceImpact: uint16(maxPIS >> 16)
            }), sellPath, buyPath);
        }
    }

    /// @inheritdoc IHotPotV2FundManagerActions
    function add(
        uint poolIndex,
        uint positionIndex,
        uint amount,
        bool collect,
        uint maxPIS
    ) external override onlyController returns(uint128 liquidity){
        require(IERC20(token).balanceOf(address(this)) >= amount, "ATL");
        require(poolIndex < pools.length, "IPL");
        require(positionIndex < positions[poolIndex].length, "IPS");

        uint amount0Max;
        uint amount1Max;
        Position.Info storage position = positions[poolIndex][positionIndex];
        address pool = pools[poolIndex];
        // 需要复投?
        if(collect) (amount0Max, amount1Max) = position.burnAndCollect(pool, 0);

        liquidity = position.addLiquidity(Position.AddParams({
            poolIndex: poolIndex,
            pool: pool,
            amount: amount,
            amount0Max: amount0Max,
            amount1Max: amount1Max,
            token: token,
            uniV3Router: uniV3Router,
            uniV3Factory: uniV3Factory,
            maxSqrtSlippage: uint16(maxPIS & 0xffff),
            maxPriceImpact: uint16(maxPIS >> 16)
        }), sellPath, buyPath);
    }

    /// @inheritdoc IHotPotV2FundManagerActions
    function sub(
        uint poolIndex,
        uint positionIndex,
        uint proportionX128,
        uint maxPIS
    ) external override onlyController returns(uint amount){
        require(poolIndex < pools.length, "IPL");
        require(positionIndex < positions[poolIndex].length, "IPS");

        amount = positions[poolIndex][positionIndex].subLiquidity(Position.SubParams({
            proportionX128: proportionX128,
            pool: pools[poolIndex],
            token: token,
            uniV3Router: uniV3Router,
            uniV3Factory: uniV3Factory,
            maxSqrtSlippage: uint16(maxPIS & 0xffff),
            maxPriceImpact: uint16(maxPIS >> 16)
        }), sellPath);
    }

    /// @inheritdoc IHotPotV2FundManagerActions
    function move(
        uint poolIndex,
        uint subIndex,
        uint addIndex,
        uint proportionX128,
        uint maxPIS
    ) external override onlyController returns(uint128 liquidity){
        require(poolIndex < pools.length, "IPL");
        require(subIndex < positions[poolIndex].length, "ISI");
        require(addIndex < positions[poolIndex].length, "IAI");

        // 移除
        (uint amount0Max, uint amount1Max) = positions[poolIndex][subIndex]
            .burnAndCollect(pools[poolIndex], proportionX128);

        // 添加
        liquidity = positions[poolIndex][addIndex].addLiquidity(Position.AddParams({
            poolIndex: poolIndex,
            pool: pools[poolIndex],
            amount: 0,
            amount0Max: amount0Max,
            amount1Max: amount1Max,
            token: token,
            uniV3Router: uniV3Router,
            uniV3Factory: uniV3Factory,
            maxSqrtSlippage: uint16(maxPIS & 0xffff),
            maxPriceImpact: uint16(maxPIS >> 16)
        }), sellPath, buyPath);
    }

    /// @inheritdoc IHotPotV2FundState
    function assetsOfPosition(uint poolIndex, uint positionIndex) public override view returns (uint amount) {
        return positions[poolIndex][positionIndex].assets(pools[poolIndex], token, sellPath, uniV3Factory);
    }

    /// @inheritdoc IHotPotV2FundState
    function assetsOfPool(uint poolIndex) public view override returns (uint amount) {
        (amount, ) = _assetsOfPool(poolIndex);
    }

    /// @inheritdoc IHotPotV2FundState
    function totalAssets() public view override returns (uint amount) {
        amount = IERC20(token).balanceOf(address(this));
        for(uint i = 0; i < pools.length; i++){
            uint _amount;
            (_amount, ) = _assetsOfPool(i);
            amount = amount.add(_amount);
        }
    }

    function _assetsOfPool(uint poolIndex) internal view returns (uint amount, uint[] memory) {
        return positions[poolIndex].assetsOfPool(pools[poolIndex], token, sellPath, uniV3Factory);
    }
}
