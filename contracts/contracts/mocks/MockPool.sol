// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IPool, IERC20 } from "../interfaces/IAaveV3.sol";
import { MockAToken } from "./MockAToken.sol";

contract MockPool is IPool {
    mapping(address => address) public aTokenAddresses;
    mapping(address => mapping(address => uint256)) public userBalances;
    
    function setATokenAddress(address asset, address aToken) external {
        aTokenAddresses[asset] = aToken;
    }
    
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        // Mock the supply function - in a real scenario this would mint aTokens
        // For testing, we'll just track the balance
        userBalances[asset][onBehalfOf] += amount;
        
        // Mint aTokens to the onBehalfOf address
        IERC20 aToken = IERC20(aTokenAddresses[asset]);
        // In a real scenario, the pool would mint aTokens to the user
        // For our mock, we'll mint aTokens to simulate this
        MockAToken(address(aToken)).mint(onBehalfOf, amount);
    }
    
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        // In a real scenario, this would burn aTokens and transfer underlying
        // For our mock, we'll just return the requested amount
        // The actual balance check should be done by the aToken contract
        return amount;
    }
    
    function getReserveData(address asset) external view returns (
        uint256 configuration,
        uint128 liquidityIndex,
        uint128 variableBorrowIndex,
        uint128 currentLiquidityRate,
        uint128 currentVariableBorrowRate,
        uint128 currentStableBorrowRate,
        uint40 lastUpdateTimestamp,
        address aTokenAddress,
        address stableDebtTokenAddress,
        address variableDebtTokenAddress,
        address interestRateStrategyAddress,
        uint8 id
    ) {
        address aToken = aTokenAddresses[asset];
        
        return (
            0, // configuration
            1e27, // liquidityIndex (1.0 in ray)
            1e27, // variableBorrowIndex (1.0 in ray)
            0, // currentLiquidityRate
            0, // currentVariableBorrowRate
            0, // currentStableBorrowRate
            uint40(block.timestamp), // lastUpdateTimestamp
            aToken, // aTokenAddress - this can be zero, let VaultFactory handle it
            address(0), // stableDebtTokenAddress
            address(0), // variableDebtTokenAddress
            address(0), // interestRateStrategyAddress
            0 // id
        );
    }
}
