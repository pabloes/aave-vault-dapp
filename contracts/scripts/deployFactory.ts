import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Factory = await ethers.getContractFactory("VaultFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  console.log("VaultFactory deployed at:", addr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
