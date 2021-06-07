// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

// used to mock USDT
contract ERC20MockNoReturn {
    using LowGasSafeMath for uint;

    string public name;
    string public symbol;
    uint8  public decimals;
    uint   public totalSupply;

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    constructor(uint amountToMint, string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        _mint(msg.sender, amountToMint);
    }

    function _approve(address owner, address spender, uint value) private {
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint value) private {
        balanceOf[from] = balanceOf[from].sub(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(from, to, value);
    }

    function approve(address spender, uint value) external{
        // To change the approve amount you first have to reduce the addresses`
        //  allowance to zero by calling `approve(_spender, 0)` if it is not
        //  already 0 to mitigate the race condition described here:
        //  https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
        require(!((value != 0) && (allowance[msg.sender][spender] != 0)));

        _approve(msg.sender, spender, value);
    }

    function transfer(address to, uint value) external{
        _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint value) external{
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
        _transfer(from, to, value);
    }

    function _mint(address to, uint value) internal returns(uint amount) {
        totalSupply = totalSupply.add(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(address(0), to, value);

        return value;
    }

    function _mint_for_testing(address to, uint value) external returns(uint amount) {
        require(to != address(0), "ERC20: mint to the zero address");

        return _mint(to, value);
    }

    function _burn(address from, uint value) internal returns(uint amount) {
        balanceOf[from] = balanceOf[from].sub(value);
        totalSupply = totalSupply.sub(value);
        emit Transfer(from, address(0), value);

        return value;
    }

    function _burn_for_testing(uint value) external returns(uint amount) {
        require(msg.sender != address(0), "ERC20: burn from the zero address");

        return _burn(msg.sender, value);
    }
}
