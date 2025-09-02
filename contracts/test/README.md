# Test Suite for Aave Vault Contracts

This directory contains comprehensive tests for the TimelockAaveVault and VaultFactory contracts.

## Test Structure

### Files
- `TimelockAaveVault.test.ts` - Tests for the TimelockAaveVault contract
- `VaultFactory.test.ts` - Tests for the VaultFactory contract
- `helpers.ts` - Common test utilities and helper functions
- `run-tests.ts` - Test runner script

### Mock Contracts
- `contracts/mocks/MockERC20.sol` - Mock ERC20 token for testing
- `contracts/mocks/MockPool.sol` - Mock Aave Pool for testing
- `contracts/mocks/MockAToken.sol` - Mock aToken for testing

## Running Tests

### Basic Test Execution
```bash
npm test
```

### With Gas Reporting
```bash
npm run test:gas
```

### With Coverage Report
```bash
npm run test:coverage
```

### Run Specific Test File
```bash
npx hardhat test test/TimelockAaveVault.test.ts
npx hardhat test test/VaultFactory.test.ts
```

## Test Coverage

### TimelockAaveVault Tests
- ✅ Constructor validation
- ✅ Deposit functionality
- ✅ Withdrawal functionality (with timelock)
- ✅ WithdrawAll functionality
- ✅ Lock extension
- ✅ Access control (onlyOwner modifier)
- ✅ Edge cases and error conditions

### VaultFactory Tests
- ✅ Vault creation
- ✅ Multiple vaults per user
- ✅ Vault indexing by owner
- ✅ Asset validation
- ✅ Integration with created vaults

## Test Utilities

### Helper Functions
- `timeTravel(seconds)` - Fast forward blockchain time
- `getCurrentTimestamp()` - Get current block timestamp
- `getFutureTimestamp(hours)` - Get future timestamp
- `getSigners()` - Get test signers
- `getAddresses(signers)` - Get addresses from signers

## Mock Contracts

The test suite uses mock contracts to simulate external dependencies:

- **MockERC20**: Simulates ERC20 tokens with minting capability
- **MockPool**: Simulates Aave V3 Pool with basic supply/withdraw functionality
- **MockAToken**: Simulates Aave aTokens with minting/burning capability

## Best Practices

1. **Isolation**: Each test is isolated and doesn't depend on other tests
2. **Setup/Teardown**: Uses `beforeEach` for clean test state
3. **Edge Cases**: Tests cover both success and failure scenarios
4. **Time Manipulation**: Uses Hardhat's time manipulation for timelock testing
5. **Event Testing**: Verifies events are emitted correctly
6. **Access Control**: Tests owner-only functions and unauthorized access

## Adding New Tests

When adding new tests:

1. Follow the existing naming convention
2. Use descriptive test names that explain the scenario
3. Test both success and failure cases
4. Use the helper functions for common operations
5. Add appropriate assertions and event checks
6. Consider gas usage for critical functions
