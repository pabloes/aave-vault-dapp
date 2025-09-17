// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAddressesProvider {
    address public dataProvider;
    address public pool;
    constructor(address _dataProvider, address _pool) { dataProvider = _dataProvider; pool = _pool; }
    function getPoolDataProvider() external view returns (address) { return dataProvider; }
    function getPool() external view returns (address) { return pool; }
}


