// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPool, IERC20 } from "./interfaces/IAaveV3.sol";

/// @title TimelockAaveVault
/// @notice A self-custodied, non-upgradeable timelock vault that deposits into Aave V3.
/// Owner is immutable and there are no admin backdoors.
contract TimelockAaveVault {
    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount, address to);
    event LockExtended(uint256 oldReleaseTime, uint256 newReleaseTime);

    address public immutable owner;
    IERC20 public immutable asset;
    IPool public immutable pool;
    IERC20 public immutable aToken;

    uint256 public releaseTime; // unix timestamp after which withdrawals are allowed

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        address _owner,
        address _asset,
        address _pool,
        address _aToken,
        uint256 _releaseTime
    ) {
        require(_owner != address(0), "owner=0");
        require(_asset != address(0), "asset=0");
        require(_pool != address(0), "pool=0");
        require(_aToken != address(0), "aToken=0");
        require(_releaseTime > block.timestamp, "release in past");
        owner = _owner;
        asset = IERC20(_asset);
        pool = IPool(_pool);
        aToken = IERC20(_aToken);
        releaseTime = _releaseTime;
    }

    /// @notice Deposits `amount` of the underlying asset into Aave on behalf of this vault.
    /// The tokens are pulled from the owner, so the owner must approve this vault first.
    function deposit(uint256 amount) external onlyOwner {
        require(amount > 0, "amount=0");
        // Pull tokens from owner to this vault
        require(asset.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        // Approve Pool for the amount
        require(asset.approve(address(pool), amount), "approve failed");
        // Supply to Aave on behalf of this vault. referralCode = 0
        pool.supply(address(asset), amount, address(this), 0);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Returns the total aToken balance held by this vault (principal + interest).
    function maxWithdrawable() public view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @notice Withdraws `amount` of underlying to `to`. Only callable after releaseTime.
    function withdraw(uint256 amount, address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(amount > 0, "amount=0");
        require(to != address(0), "to=0");
        uint256 withdrawn = pool.withdraw(address(asset), amount, to);
        require(withdrawn == amount, "partial withdraw");
        emit Withdrawn(msg.sender, amount, to);
    }

    /// @notice Withdraws all available underlying to `to`. Only callable after releaseTime.
    function withdrawAll(address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        uint256 amount = maxWithdrawable();
        pool.withdraw(address(asset), type(uint256).max, to);
        emit Withdrawn(msg.sender, amount, to);
    }

    /// @notice Extends the lock to a later timestamp. Cannot decrease.
    function extendLock(uint256 newReleaseTime) external onlyOwner {
        require(newReleaseTime > releaseTime, "must increase");
        uint256 old = releaseTime;
        releaseTime = newReleaseTime;
        emit LockExtended(old, newReleaseTime);
    }
}
