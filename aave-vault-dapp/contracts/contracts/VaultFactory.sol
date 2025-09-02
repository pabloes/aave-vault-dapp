// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TimelockAaveVault } from "./TimelockAaveVault.sol";
import { IPool } from "./interfaces/IAaveV3.sol";

/// @title VaultFactory
/// @notice Creates timelock Aave vaults and keeps an on-chain index per owner.
contract VaultFactory {
    event VaultCreated(address indexed owner, address vault, address asset, address pool, address aToken, uint256 releaseTime);

    mapping(address => address[]) private _ownerToVaults;

    function createVault(
        address asset,
        address pool,
        uint256 releaseTime
    ) external returns (address vault) {
        // Get aToken address from the pool
        IPool poolContract = IPool(pool);
        (,,,,,,,, address aTokenAddress,,,) = poolContract.getReserveData(asset);
        require(aTokenAddress != address(0), "Asset not supported by pool");
        
        TimelockAaveVault v = new TimelockAaveVault(msg.sender, asset, pool, aTokenAddress, releaseTime);
        vault = address(v);
        _ownerToVaults[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, asset, pool, aTokenAddress, releaseTime);
    }

    function getVaultsByOwner(address owner) external view returns (address[] memory) {
        return _ownerToVaults[owner];
    }
}
