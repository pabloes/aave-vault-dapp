import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { timeTravel, getFutureTimestamp } from "./helpers";

// We'll use any for now since typechain types aren't generated yet
type TimelockAaveVault = any;
type MockERC20 = any;
type MockPool = any;
type MockAToken = any;

describe("TimelockAaveVault", function () {
  let timelockVault: TimelockAaveVault;
  let mockAsset: MockERC20;
  let mockPool: MockPool;
  let mockAToken: MockAToken;
  let owner: Signer;
  let nonOwner: Signer;
  let ownerAddress: string;
  let nonOwnerAddress: string;
  let futureTime: number;

  beforeEach(async function () {
    [owner, nonOwner] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    nonOwnerAddress = await nonOwner.getAddress();
    futureTime = await getFutureTimestamp(24); // 24 hours from now

    // Deploy mock contracts
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockAsset = await MockERC20Factory.deploy("Mock Token", "MTK");

    const MockPoolFactory = await ethers.getContractFactory("MockPool");
    mockPool = await MockPoolFactory.deploy();

    const MockATokenFactory = await ethers.getContractFactory("MockAToken");
    mockAToken = await MockATokenFactory.deploy("Mock aToken", "MaTK");

    // Set up mock pool to return the aToken address
    await mockPool.setATokenAddress(await mockAsset.getAddress(), await mockAToken.getAddress());

    // Deploy the vault
    const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
    timelockVault = await TimelockAaveVaultFactory.deploy(
      ownerAddress,
      await mockAsset.getAddress(),
      await mockPool.getAddress(),
      await mockAToken.getAddress(),
      futureTime
    );

    // Mint some tokens to the owner
    await mockAsset.mint(ownerAddress, ethers.parseEther("1000"));
  });

  describe("Constructor", function () {
    it("Should set the correct initial state", async function () {
      expect(await timelockVault.owner()).to.equal(ownerAddress);
      expect(await timelockVault.asset()).to.equal(await mockAsset.getAddress());
      expect(await timelockVault.pool()).to.equal(await mockPool.getAddress());
      expect(await timelockVault.aToken()).to.equal(await mockAToken.getAddress());
      expect(await timelockVault.releaseTime()).to.equal(futureTime);
    });

    it("Should revert if owner is zero address", async function () {
      const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
      await expect(
        TimelockAaveVaultFactory.deploy(
          ethers.ZeroAddress,
          await mockAsset.getAddress(),
          await mockPool.getAddress(),
          await mockAToken.getAddress(),
          futureTime
        )
      ).to.be.revertedWith("owner=0");
    });

    it("Should revert if asset is zero address", async function () {
      const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
      await expect(
        TimelockAaveVaultFactory.deploy(
          ownerAddress,
          ethers.ZeroAddress,
          await mockPool.getAddress(),
          await mockAToken.getAddress(),
          futureTime
        )
      ).to.be.revertedWith("asset=0");
    });

    it("Should revert if pool is zero address", async function () {
      const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
      await expect(
        TimelockAaveVaultFactory.deploy(
          ownerAddress,
          await mockAsset.getAddress(),
          ethers.ZeroAddress,
          await mockAToken.getAddress(),
          futureTime
        )
      ).to.be.revertedWith("pool=0");
    });

    it("Should revert if aToken is zero address", async function () {
      const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
      await expect(
        TimelockAaveVaultFactory.deploy(
          ownerAddress,
          await mockAsset.getAddress(),
          await mockPool.getAddress(),
          ethers.ZeroAddress,
          futureTime
        )
      ).to.be.revertedWith("aToken=0");
    });

    it("Should revert if release time is in the past", async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 86400; // 24 hours ago
      const TimelockAaveVaultFactory = await ethers.getContractFactory("TimelockAaveVault");
      await expect(
        TimelockAaveVaultFactory.deploy(
          ownerAddress,
          await mockAsset.getAddress(),
          await mockPool.getAddress(),
          await mockAToken.getAddress(),
          pastTime
        )
      ).to.be.revertedWith("release in past");
    });
  });

  describe("deposit", function () {
    beforeEach(async function () {
      // Approve the vault to spend owner's tokens
      await mockAsset.connect(owner).approve(await timelockVault.getAddress(), ethers.parseEther("100"));
    });

    it("Should deposit tokens successfully", async function () {
      const depositAmount = ethers.parseEther("50");
      await expect(timelockVault.connect(owner).deposit(depositAmount))
        .to.emit(timelockVault, "Deposited")
        .withArgs(ownerAddress, depositAmount);
    });

    it("Should allow non-owner to deposit their own tokens", async function () {
      const depositAmount = ethers.parseEther("50");
      // Mint tokens to nonOwner and approve the vault
      await mockAsset.mint(nonOwnerAddress, depositAmount);
      await mockAsset.connect(nonOwner).approve(await timelockVault.getAddress(), depositAmount);
      await expect(timelockVault.connect(nonOwner).deposit(depositAmount))
        .to.emit(timelockVault, "Deposited")
        .withArgs(nonOwnerAddress, depositAmount);
    });

    it("Should revert if amount is zero", async function () {
      await expect(timelockVault.connect(owner).deposit(0))
        .to.be.revertedWith("amount=0");
    });

    it("Should revert if transferFrom fails", async function () {
      const depositAmount = ethers.parseEther("50");
      // Don't approve tokens
      await mockAsset.connect(owner).approve(await timelockVault.getAddress(), 0);
      await expect(timelockVault.connect(owner).deposit(depositAmount))
        .to.be.revertedWith("Insufficient allowance");
    });
  });

  describe("maxWithdrawable", function () {
    it("Should return the correct aToken balance", async function () {
      const balance = await mockAToken.balanceOf(await timelockVault.getAddress());
      expect(await timelockVault.maxWithdrawable()).to.equal(balance);
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      // Setup: deposit some tokens first
      await mockAsset.connect(owner).approve(await timelockVault.getAddress(), ethers.parseEther("100"));
      await timelockVault.connect(owner).deposit(ethers.parseEther("50"));
    });

    it("Should withdraw tokens successfully after release time", async function () {
      // Fast forward time
      await timeTravel(86400); // 24 hours

      const withdrawAmount = ethers.parseEther("25");
      await expect(timelockVault.connect(owner).withdraw(withdrawAmount, nonOwnerAddress))
        .to.emit(timelockVault, "Withdrawn")
        .withArgs(ownerAddress, withdrawAmount, nonOwnerAddress);
    });

    it("Should revert if called before release time", async function () {
      const withdrawAmount = ethers.parseEther("25");
      await expect(timelockVault.connect(owner).withdraw(withdrawAmount, nonOwnerAddress))
        .to.be.revertedWith("locked");
    });

    it("Should revert if called by non-owner", async function () {
      // Fast forward time
      await timeTravel(86400);

      const withdrawAmount = ethers.parseEther("25");
      await expect(timelockVault.connect(nonOwner).withdraw(withdrawAmount, nonOwnerAddress))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if amount is zero", async function () {
      // Fast forward time
      await timeTravel(86400);

      await expect(timelockVault.connect(owner).withdraw(0, nonOwnerAddress))
        .to.be.revertedWith("amount=0");
    });

    it("Should revert if recipient is zero address", async function () {
      // Fast forward time
      await timeTravel(86400);

      const withdrawAmount = ethers.parseEther("25");
      await expect(timelockVault.connect(owner).withdraw(withdrawAmount, ethers.ZeroAddress))
        .to.be.revertedWith("to=0");
    });
  });

  describe("withdrawAll", function () {
    beforeEach(async function () {
      // Setup: deposit some tokens first
      await mockAsset.connect(owner).approve(await timelockVault.getAddress(), ethers.parseEther("100"));
      await timelockVault.connect(owner).deposit(ethers.parseEther("50"));
    });

    it("Should withdraw all tokens successfully after release time", async function () {
      // Fast forward time
      await timeTravel(86400);

      const maxWithdrawable = await timelockVault.maxWithdrawable();
      await expect(timelockVault.connect(owner).withdrawAll(nonOwnerAddress))
        .to.emit(timelockVault, "Withdrawn")
        .withArgs(ownerAddress, maxWithdrawable, nonOwnerAddress);
    });

    it("Should revert if called before release time", async function () {
      await expect(timelockVault.connect(owner).withdrawAll(nonOwnerAddress))
        .to.be.revertedWith("locked");
    });

    it("Should revert if called by non-owner", async function () {
      // Fast forward time
      await timeTravel(86400);

      await expect(timelockVault.connect(nonOwner).withdrawAll(nonOwnerAddress))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if recipient is zero address", async function () {
      // Fast forward time
      await timeTravel(86400);

      await expect(timelockVault.connect(owner).withdrawAll(ethers.ZeroAddress))
        .to.be.revertedWith("to=0");
    });
  });

  describe("extendLock", function () {
    it("Should extend lock time successfully", async function () {
      const newReleaseTime = futureTime + 86400; // 48 hours from now
      const oldReleaseTime = await timelockVault.releaseTime();
      
      await expect(timelockVault.connect(owner).extendLock(newReleaseTime))
        .to.emit(timelockVault, "LockExtended")
        .withArgs(oldReleaseTime, newReleaseTime);
      
      expect(await timelockVault.releaseTime()).to.equal(newReleaseTime);
    });

    it("Should revert if called by non-owner", async function () {
      const newReleaseTime = futureTime + 86400;
      await expect(timelockVault.connect(nonOwner).extendLock(newReleaseTime))
        .to.be.revertedWith("Not owner");
    });

    it("Should revert if new release time is not greater than current", async function () {
      const sameReleaseTime = futureTime;
      await expect(timelockVault.connect(owner).extendLock(sameReleaseTime))
        .to.be.revertedWith("must increase");
    });

    it("Should revert if new release time is less than current", async function () {
      const earlierReleaseTime = futureTime - 3600; // 1 hour earlier
      await expect(timelockVault.connect(owner).extendLock(earlierReleaseTime))
        .to.be.revertedWith("must increase");
    });
  });
});
