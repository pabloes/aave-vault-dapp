import { expect } from "chai";
import { ethers } from "hardhat";

describe("Simple VaultFactory", function () {
  it("Should create a vault successfully", async function () {
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
    await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());

    // Deploy the factory
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = await VaultFactoryFactory.deploy();

    // Create vault
    const tx = await vaultFactory.connect(user).createVault(
      await mockAsset.getAddress(),
      await mockPool.getAddress(),
      futureTime
    );

    await expect(tx)
      .to.emit(vaultFactory, "VaultCreated");

    const vaults = await vaultFactory.getVaultsByOwner(userAddress);
    expect(vaults.length).to.equal(1);
  });
});
