import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { timeTravel, getFutureTimestamp } from "./helpers";

// We'll use any for now since typechain types aren't generated yet
type VaultFactory = any;
type TimelockAaveVault = any;
type MockERC20 = any;
type MockPool = any;
type MockAToken = any;

describe("VaultFactory", function () {
  let vaultFactory: VaultFactory;
  let mockAsset: MockERC20;
  let mockPool: MockPool;
  let mockAToken: MockAToken;
  let user: Signer;
  let anotherUser: Signer;
  let userAddress: string;
  let anotherUserAddress: string;
  let futureTime: number;

  beforeEach(async function () {
    [user, anotherUser] = await ethers.getSigners();
    userAddress = await user.getAddress();
    anotherUserAddress = await anotherUser.getAddress();
    futureTime = await getFutureTimestamp(24); // 24 hours from now

    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    // Set up mock pool to return the aToken address
    const tx = await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());
    await tx.wait();

    // Verify the setup worked
    const aTokenAddress = await mockPool.aTokenAddresses(await mockAsset.getAddress());
    console.log("Setup - aTokenAddress:", aTokenAddress);
    console.log("Setup - Expected aTokenAddress:", await mockAToken.getAddress());

    // Deploy the factory
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    vaultFactory = await VaultFactoryFactory.deploy();
  });

  describe("createVault", function () {
    it("Should create a vault successfully", async function () {
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

    it("Should create multiple vaults for the same user", async function () {
      // Create first vault
      await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      // Create second vault
      await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime + 86400
      );

      const vaults = await vaultFactory.getVaultsByOwner(userAddress);
      expect(vaults.length).to.equal(2);
    });

    it("Should create vaults for different users", async function () {
      // Create vault for first user
      await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      // Create vault for second user
      await vaultFactory.connect(anotherUser).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      const userVaults = await vaultFactory.getVaultsByOwner(userAddress);
      const anotherUserVaults = await vaultFactory.getVaultsByOwner(anotherUserAddress);
      
      expect(userVaults.length).to.equal(1);
      expect(anotherUserVaults.length).to.equal(1);
      expect(userVaults[0]).to.not.equal(anotherUserVaults[0]);
    });

    it("Should revert if asset is not supported by pool", async function () {
      // Set pool to return zero address for aToken
      await mockPool.setATokenAddress(await mockAsset.getAddress(), ethers.ZeroAddress);

      await expect(vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      )).to.be.revertedWith("Asset not supported by pool");
    });

    it("Should create vault with correct parameters", async function () {
      const tx = await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = vaultFactory.interface.parseLog(log as any);
          return parsed?.name === "VaultCreated";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsedEvent = vaultFactory.interface.parseLog(event as any);
        const vaultAddress = parsedEvent?.args[1];
        
        // Verify the created vault has correct parameters
        const vault = await ethers.getContractAt("TimelockAaveVault", vaultAddress);
        expect(await vault.owner()).to.equal(userAddress);
        expect(await vault.asset()).to.equal(await mockAsset.getAddress());
        expect(await vault.pool()).to.equal(await mockPool.getAddress());
        expect(await vault.aToken()).to.equal(await mockAToken.getAddress());
        expect(await vault.releaseTime()).to.equal(futureTime);
      }
    });
  });

  describe("getVaultsByOwner", function () {
    it("Should return empty array for user with no vaults", async function () {
      const vaults = await vaultFactory.getVaultsByOwner(userAddress);
      expect(vaults.length).to.equal(0);
    });

    it("Should return correct vaults for user", async function () {
      // Create vault
      await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      const vaults = await vaultFactory.getVaultsByOwner(userAddress);
      expect(vaults.length).to.equal(1);
      
      // Verify the vault is a valid TimelockAaveVault
      const vault = await ethers.getContractAt("TimelockAaveVault", vaults[0]);
      expect(await vault.owner()).to.equal(userAddress);
    });

    it("Should return vaults in creation order", async function () {
      // Create first vault
      const tx1 = await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );
      const receipt1 = await tx1.wait();
      const event1 = receipt1?.logs.find(log => {
        try {
          const parsed = vaultFactory.interface.parseLog(log as any);
          return parsed?.name === "VaultCreated";
        } catch {
          return false;
        }
      });
      const vault1Address = vaultFactory.interface.parseLog(event1 as any)?.args[1];

      // Create second vault
      const tx2 = await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime + 86400
      );
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find(log => {
        try {
          const parsed = vaultFactory.interface.parseLog(log as any);
          return parsed?.name === "VaultCreated";
        } catch {
          return false;
        }
      });
      const vault2Address = vaultFactory.interface.parseLog(event2 as any)?.args[1];

      const vaults = await vaultFactory.getVaultsByOwner(userAddress);
      expect(vaults.length).to.equal(2);
      expect(vaults[0]).to.equal(vault1Address);
      expect(vaults[1]).to.equal(vault2Address);
    });

    it("Should return empty array for zero address", async function () {
      const vaults = await vaultFactory.getVaultsByOwner(ethers.ZeroAddress);
      expect(vaults.length).to.equal(0);
    });
  });

  describe("Integration", function () {
    it("Should allow interaction with created vault", async function () {
      // Create vault
      await vaultFactory.connect(user).createVault(
        await mockAsset.getAddress(),
        await mockPool.getAddress(),
        futureTime
      );

      const vaults = await vaultFactory.getVaultsByOwner(userAddress);
      const vault = await ethers.getContractAt("TimelockAaveVault", vaults[0]);

      // Mint tokens to user
      await mockAsset.mint(userAddress, ethers.parseEther("1000"));
      
      // Approve vault to spend tokens
      await mockAsset.connect(user).approve(await vault.getAddress(), ethers.parseEther("100"));
      
      // Deposit tokens
      await expect(vault.connect(user).deposit(ethers.parseEther("50")))
        .to.emit(vault, "Deposited")
        .withArgs(userAddress, ethers.parseEther("50"));
    });
  });
});
