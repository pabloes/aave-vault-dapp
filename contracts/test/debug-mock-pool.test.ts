import { expect } from "chai";
import { ethers } from "hardhat";

describe("Debug MockPool", function () {
  it("Should debug MockPool step by step", async function () {
    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    const mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    console.log("Asset address:", await mockAsset.getAddress());
    console.log("aToken address:", await mockAToken.getAddress());
    console.log("Pool address:", await mockPool.getAddress());

    // Check initial state
    const initialAToken = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("Initial aToken address:", initialAToken);

    // Set up mock pool to return the aToken address
    const tx = await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());
    await tx.wait();
    console.log("setATokenAddress transaction completed");

    // Check after setting
    const afterAToken = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("After setATokenAddress aToken address:", afterAToken);
    console.log("Expected aToken address:", await mockAToken.getAddress());

    expect(afterAToken).to.equal(await mockAToken.getAddress());

    // Try getReserveData
    const reserveData = await mockPool.getReserveData(await mockAsset.getAddress());
    console.log("getReserveData aTokenAddress:", reserveData[7]);
    console.log("Expected aTokenAddress:", await mockAToken.getAddress());

    expect(reserveData[7]).to.equal(await mockAToken.getAddress());
  });
});
