// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockProtocolDataProvider {
    struct TokenData { string symbol; address tokenAddress; }
    TokenData[] private _reserves;
    mapping(address => address) public assetToAToken;

    function setReserve(address asset, string calldata symbol, address aToken) external {
        _reserves.push(TokenData({ symbol: symbol, tokenAddress: asset }));
        assetToAToken[asset] = aToken;
    }

    function getAllReservesTokens() external view returns (TokenData[] memory) {
        return _reserves;
    }

    function getReserveTokensAddresses(address asset) external view returns (address,address,address) {
        return (assetToAToken[asset], address(0), address(0));
    }
}


