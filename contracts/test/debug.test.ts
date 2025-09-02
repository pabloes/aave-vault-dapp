import { expect } from "chai";
import { ethers } from "hardhat";

describe("Debug", function () {
  it("Should debug mock pool setup", async function () {
    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    const mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    // Set up mock pool to return the aToken address
    await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());

    // Test if the setup worked
    const aTokenAddress = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("aTokenAddress:", aTokenAddress);
    console.log("Expected aTokenAddress:", await mockAToken.getAddress());
    
    expect(aTokenAddress).to.equal(await mockAToken.getAddress());
  });
});
