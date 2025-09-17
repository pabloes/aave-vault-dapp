// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MultiTokenTimelock } from "./MultiTokenTimelock.sol";

contract MultiTokenTimelockFactory {
    event TimelockCreated(address indexed owner, address timelock, uint256 releaseTime, address addressesProvider);

    mapping(address => address[]) private _ownerToTimelocks;

    function createTimelock(address addressesProvider, uint256 releaseTime) external returns (address timelock) {
        MultiTokenTimelock vault = new MultiTokenTimelock(msg.sender, releaseTime, addressesProvider);
        timelock = address(vault);
        _ownerToTimelocks[msg.sender].push(timelock);
        emit TimelockCreated(msg.sender, timelock, releaseTime, addressesProvider);
    }

    function getTimelocksByOwner(address owner) external view returns (address[] memory) {
        return _ownerToTimelocks[owner];
    }
}


