import { expect } from "chai";
import { ethers } from "hardhat";

describe("Debug VaultFactory Direct", function () {
  it("Should debug VaultFactory createVault directly", async function () {
    const [user] = await ethers.getSigners();
    const userAddress = await user.getAddress();
    const futureTime = Math.floor(Date.now() / 1000) + 86400;

    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    const mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    // Set up mock pool to return the aToken address
    const tx = await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());
    await tx.wait();

    // Deploy the factory
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = await VaultFactoryFactory.deploy();

    // Verify setup
    const aTokenAddress = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("Asset address:", await mockAsset.getAddress());
    console.log("aToken address:", aTokenAddress);
    console.log("Expected aToken address:", await mockAToken.getAddress());

    // Try to call getReserveData directly on the pool
    const reserveData = await mockPool.getReserveData(await mockAsset.getAddress());
    console.log("getReserveData aTokenAddress:", reserveData[7]);

    // Now try to create a vault by calling the factory directly
    try {
      const createVaultTx = await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );
      console.log("Vault created successfully!");
      
      // Wait for the transaction
      const receipt = await createVaultTx.wait();
      console.log("Transaction receipt:", receipt);
    } catch (error) {
      console.log("Error creating vault:", error.message);
      
      // Try to get more details about the error
      if (error.data) {
        console.log("Error data:", error.data);
      }
    }
  });
});
