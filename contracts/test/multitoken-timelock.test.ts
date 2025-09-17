import { expect } from "chai";
import { ethers } from "hardhat";

describe("MultiTokenTimelock", function () {
  it("constructor guards and onlyOwner", async () => {
    const [owner, other] = await ethers.getSigners();
    const Prov = await ethers.getContractFactory("MockAddressesProvider");
    const dpAddr = owner.address;
    const prov = await Prov.deploy(dpAddr);
    await prov.waitForDeployment();

    await expect((await ethers.getContractFactory("MultiTokenTimelock")).deploy(ethers.ZeroAddress, 9999999999n, await prov.getAddress())).to.be.revertedWith('owner=0');
    await expect((await ethers.getContractFactory("MultiTokenTimelock")).deploy(owner.address, 1n, await prov.getAddress())).to.be.revertedWith('release in past');
    await expect((await ethers.getContractFactory("MultiTokenTimelock")).deploy(owner.address, 9999999999n, ethers.ZeroAddress)).to.be.revertedWith('addrProv=0');

    const MT = await ethers.getContractFactory("MultiTokenTimelock");
    const rel = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 60);
    const tl = await MT.deploy(owner.address, rel, await prov.getAddress());
    await tl.waitForDeployment();

    await expect(tl.connect(other).extendLock(rel + 10n)).to.be.revertedWith('Not owner');
  });
  it("creates timelock via factory and lists by owner", async () => {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MultiTokenTimelockFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const rel = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const tx = await factory.createTimelock(owner.address, rel);
    const rc = await tx.wait();
    const timelockAddr = await (async () => {
      const receipt = await ethers.provider.getTransactionReceipt(rc!.hash);
      const iface = new ethers.Interface(["event TimelockCreated(address indexed owner,address timelock,uint256 releaseTime,address addressesProvider)"]);
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog(log as any);
          if (parsed && parsed.name === 'TimelockCreated') return parsed.args.timelock as string;
        } catch {}
      }
      throw new Error('TimelockCreated not found');
    })();
    const list = await factory.getTimelocksByOwner(owner.address);
    expect(list).to.include(timelockAddr);
  });

  it("enforces lock and allows sweep per token after release", async () => {
    const [owner, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const t1 = await Token.deploy("Token1","T1");
    await t1.waitForDeployment();

    const MT = await ethers.getContractFactory("MultiTokenTimelock");
    const release = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 3);
    const timelock = await MT.deploy(owner.address, release, owner.address);
    await timelock.waitForDeployment();

    // send tokens to timelock
    await (await t1.mint(owner.address, ethers.parseEther("1"))).wait();
    await (await t1.transfer(await timelock.getAddress(), ethers.parseEther("1"))).wait();

    // before release (use fresh deployment with future release to ensure state)
    const future = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 60);
    const timelock2 = await MT.deploy(owner.address, future, owner.address);
    await timelock2.waitForDeployment();
    await (await t1.mint(owner.address, ethers.parseEther("0.5"))).wait();
    await (await t1.transfer(await timelock2.getAddress(), ethers.parseEther("0.5"))).wait();
    await expect(timelock2.sweepTokenAfterRelease(await t1.getAddress(), owner.address)).to.be.revertedWith("locked");

    // wait release
    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);

    const balBefore = await t1.balanceOf(owner.address);
    await (await timelock.sweepTokenAfterRelease(await t1.getAddress(), owner.address)).wait();
    const balAfter = await t1.balanceOf(owner.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("1"));
  });

  it("extendLock increases and emits event", async () => {
    const [owner] = await ethers.getSigners();
    const Prov = await ethers.getContractFactory("MockAddressesProvider");
    const prov = await Prov.deploy(owner.address);
    await prov.waitForDeployment();
    const MT = await ethers.getContractFactory("MultiTokenTimelock");
    const rel = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 60);
    const tl = await MT.deploy(owner.address, rel, await prov.getAddress());
    await tl.waitForDeployment();
    const newRel = rel + 120n;
    await expect(tl.extendLock(newRel)).to.emit(tl, 'LockExtended').withArgs(rel, newRel);
    expect(await tl.releaseTime()).to.equal(newRel);
  });

  it("sweepTokensAfterRelease sweeps subset and skips zero balances", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const t1 = await Token.deploy("T1","T1");
    const t2 = await Token.deploy("T2","T2");
    await t1.waitForDeployment();
    await t2.waitForDeployment();
    const Prov = await ethers.getContractFactory("MockAddressesProvider");
    const prov = await Prov.deploy(owner.address);
    await prov.waitForDeployment();
    const MT = await ethers.getContractFactory("MultiTokenTimelock");
    const rel = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 3);
    const tl = await MT.deploy(owner.address, rel, await prov.getAddress());
    await tl.waitForDeployment();
    await (await t1.mint(owner.address, ethers.parseEther('1'))).wait();
    await (await t1.transfer(await tl.getAddress(), ethers.parseEther('1'))).wait();
    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);
    const b1 = await t1.balanceOf(owner.address);
    const b2 = await t2.balanceOf(owner.address);
    await (await tl.sweepTokensAfterRelease([await t1.getAddress(), await t2.getAddress()], owner.address)).wait();
    expect((await t1.balanceOf(owner.address)) - b1).to.equal(ethers.parseEther('1'));
    expect(await t2.balanceOf(owner.address)).to.equal(b2);
  });

  it("sweeps all aTokens via DataProvider after release", async () => {
    const [owner] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const asset = await Token.deploy("Asset","AST");
    const aToken = await Token.deploy("aAsset","aAST");
    await asset.waitForDeployment();
    await aToken.waitForDeployment();

    const Data = await ethers.getContractFactory("MockProtocolDataProvider");
    const dp = await Data.deploy();
    await dp.waitForDeployment();
    await (await dp.setReserve(await asset.getAddress(), "AST", await aToken.getAddress())).wait();

    const Prov = await ethers.getContractFactory("MockAddressesProvider");
    const prov = await Prov.deploy(await dp.getAddress());
    await prov.waitForDeployment();

    const MT = await ethers.getContractFactory("MultiTokenTimelock");
    const release = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 3);
    const timelock = await MT.deploy(owner.address, release, await prov.getAddress());
    await timelock.waitForDeployment();

    // send aTokens to timelock
    await (await aToken.mint(owner.address, ethers.parseEther("2"))).wait();
    await (await aToken.transfer(await timelock.getAddress(), ethers.parseEther("2"))).wait();

    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine", []);

    const balBefore = await aToken.balanceOf(owner.address);
    await (await timelock.sweepAllATokensAfterRelease(owner.address)).wait();
    const balAfter = await aToken.balanceOf(owner.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("2"));
  });
});


