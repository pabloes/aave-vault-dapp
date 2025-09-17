// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPoolAddressesProviderLite {
    function getPoolDataProvider() external view returns (address);
    function getPool() external view returns (address);
}
interface IPoolLite {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IProtocolDataProviderLite {
    struct TokenData { string symbol; address tokenAddress; }
    function getAllReservesTokens() external view returns (TokenData[] memory);
    function getReserveTokensAddresses(address asset) external view returns (
        address aTokenAddress,
        address stableDebtTokenAddress,
        address variableDebtTokenAddress
    );
}

contract MultiTokenTimelock {
    event LockExtended(uint256 oldReleaseTime, uint256 newReleaseTime);
    event TokenSwept(address indexed token, uint256 amount, address to);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address public owner;
    address public pendingOwner;
    uint256 public releaseTime;

    IPoolAddressesProviderLite public immutable addressesProvider;

    // Tracks total principal deposited per underlying asset
    mapping(address => uint256) public principalByAsset;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _owner, uint256 _releaseTime, address _addressesProvider) {
        require(_owner != address(0), "owner=0");
        require(_releaseTime > block.timestamp, "release in past");
        require(_addressesProvider != address(0), "addrProv=0");
        owner = _owner;
        releaseTime = _releaseTime;
        addressesProvider = IPoolAddressesProviderLite(_addressesProvider);
    }

    // Two-step ownership transfer for safety
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pendingOwner");
        address old = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }

    // Deposit an ERC-20 asset into Aave on behalf of this timelock.
    // Pool can be provided explicitly; if zero, it is resolved from AddressesProvider.
    function deposit(address asset, address pool, uint256 amount) external {
        require(amount > 0, "amount=0");
        require(asset != address(0), "asset=0");
        // pull tokens from sender
        require(IERC20Like(asset).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        // resolve pool
        address poolAddr = pool;
        if (poolAddr == address(0)) {
            poolAddr = addressesProvider.getPool();
        }
        require(poolAddr != address(0), "pool=0");
        // approve and supply
        require(IERC20Like(asset).approve(poolAddr, amount), "approve failed");
        IPoolLite(poolAddr).supply(asset, amount, address(this), 0);
        // account principal
        principalByAsset[asset] += amount;
    }

    function getPosition(address asset) external view returns (uint256 principal, uint256 withdrawable, int256 growthBps) {
        principal = principalByAsset[asset];
        address dataProvider = addressesProvider.getPoolDataProvider();
        (address aToken,,) = IProtocolDataProviderLite(dataProvider).getReserveTokensAddresses(asset);
        if (aToken != address(0)) {
            withdrawable = IERC20Like(aToken).balanceOf(address(this));
        }
        if (principal == 0) {
            growthBps = 0;
        } else if (withdrawable >= principal) {
            growthBps = int256(((withdrawable - principal) * 10000) / principal);
        } else {
            growthBps = -int256(((principal - withdrawable) * 10000) / principal);
        }
    }

    function withdrawUnderlying(address asset, uint256 amount, address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        address poolAddr = addressesProvider.getPool();
        uint256 w = IPoolLite(poolAddr).withdraw(asset, amount, to);
        if (principalByAsset[asset] > w) {
            principalByAsset[asset] -= w;
        } else {
            principalByAsset[asset] = 0;
        }
    }

    function withdrawAllUnderlying(address asset, address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        address poolAddr = addressesProvider.getPool();
        uint256 w = IPoolLite(poolAddr).withdraw(asset, type(uint256).max, to);
        if (principalByAsset[asset] > w) {
            principalByAsset[asset] -= w;
        } else {
            principalByAsset[asset] = 0;
        }
    }

    function extendLock(uint256 newReleaseTime) external onlyOwner {
        require(newReleaseTime > releaseTime, "must increase");
        uint256 old = releaseTime;
        releaseTime = newReleaseTime;
        emit LockExtended(old, newReleaseTime);
    }

    function sweepTokenAfterRelease(address token, address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        uint256 bal = IERC20Like(token).balanceOf(address(this));
        require(bal > 0, "no balance");
        require(IERC20Like(token).transfer(to, bal), "transfer failed");
        emit TokenSwept(token, bal, to);
    }

    function sweepTokensAfterRelease(address[] calldata tokens, address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = IERC20Like(tokens[i]).balanceOf(address(this));
            if (bal > 0) {
                require(IERC20Like(tokens[i]).transfer(to, bal), "transfer failed");
                emit TokenSwept(tokens[i], bal, to);
            }
        }
    }

    // Sweep all aTokens supported by the current Aave market (by reading ProtocolDataProvider)
    function sweepAllATokensAfterRelease(address to) external onlyOwner {
        require(block.timestamp >= releaseTime, "locked");
        require(to != address(0), "to=0");
        address dataProvider = addressesProvider.getPoolDataProvider();
        IProtocolDataProviderLite.TokenData[] memory reserves = IProtocolDataProviderLite(dataProvider).getAllReservesTokens();
        for (uint256 i = 0; i < reserves.length; i++) {
            (address aToken,,) = IProtocolDataProviderLite(dataProvider).getReserveTokensAddresses(reserves[i].tokenAddress);
            if (aToken != address(0)) {
                uint256 bal = IERC20Like(aToken).balanceOf(address(this));
                if (bal > 0) {
                    require(IERC20Like(aToken).transfer(to, bal), "transfer failed");
                    emit TokenSwept(aToken, bal, to);
                }
            }
        }
    }
}
