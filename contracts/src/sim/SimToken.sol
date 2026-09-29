// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SimToken
/// @notice TESTNET SIMULATION ONLY. A valueless stand-in for a 6-decimal stablecoin (AUSD or USDC)
/// so the testnet sim venues can run without Agora's empty faucet. Anyone can draw from `faucet`;
/// only the sim venues (minters) can mint beyond that, to pay out simulated profit.
contract SimToken is ERC20, Ownable {
    uint8 internal immutable _decimals;
    /// @notice Most one faucet call can mint (10,000 whole tokens).
    uint256 public immutable faucetMax;

    mapping(address => bool) public isMinter;

    event MinterSet(address indexed minter, bool allowed);

    error NotMinter(address caller);
    error FaucetMaxExceeded(uint256 amount, uint256 max);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
        faucetMax = 10_000 * 10 ** decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mints up to `faucetMax` to `to`. Testnet only; the token has no value.
    function faucet(address to, uint256 amount) external {
        if (amount > faucetMax) revert FaucetMaxExceeded(amount, faucetMax);
        _mint(to, amount);
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender]) revert NotMinter(msg.sender);
        _mint(to, amount);
    }
}
