import { expect } from "chai";
import { ethers } from "hardhat";

describe("Debug VaultFactory", function () {
  it("Should debug VaultFactory createVault", async function () {
    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    const mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    // Set up mock pool to return the aToken address
    await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());

    // Verify the setup worked
    const aTokenAddress = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("Asset address:", await mockAsset.getAddress());
    console.log("aTokenAddress:", aTokenAddress);
    console.log("Expected aTokenAddress:", await mockAToken.getAddress());
    
    expect(aTokenAddress).to.equal(await mockAToken.getAddress());

    // Deploy the factory
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = await VaultFactoryFactory.deploy();

    // Try to call getReserveData directly
    const reserveData = await mockPool.getReserveData(await mockAsset.getAddress());
    console.log("Reserve data aTokenAddress:", reserveData[7]); // aTokenAddress is at index 7

    // Now try to create a vault
    const futureTime = Math.floor(Date.now() / 1000) + 86400;
    const [user] = await ethers.getSigners();
    
    try {
      const tx = await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );
      console.log("Vault created successfully!");
    } catch (error) {
      console.log("Error creating vault:", error.message);
    }
  });
});
