// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

contract ERC20Mock {
    using LowGasSafeMath for uint;

    string public name;
    string public symbol;
    uint8 public decimals;
    uint public totalSupply;

    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    constructor(
        uint amountToMint,
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ){
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        _mint(msg.sender, amountToMint);
    }

    function _approve(address owner, address spender, uint value) private {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint value) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        balanceOf[from] = balanceOf[from].sub(value);
        balanceOf[to] = balanceOf[to].add(value);
        emit Transfer(from, to, value);
    }

    function approve(address spender, uint value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external returns (bool) {
        allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
        _transfer(from, to, value);
        return true;
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
