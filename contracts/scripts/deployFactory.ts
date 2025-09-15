import { ethers } from "hardhat";
import { run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Factory = await ethers.getContractFactory("VaultFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  console.log("VaultFactory deployed at:", addr);

  // Try to verify automatically (if API keys and network support are configured)
  try {
    // Wait for a few block confirmations where relevant
    const net = await ethers.provider.getNetwork();
    const chainId = Number(net.chainId);
    if (chainId !== 31337) {
      console.log("Verifying contract on explorer...");
      await run("verify:verify", {
        address: addr,
        constructorArguments: []
      });
      console.log("Verification submitted.");
    }
  } catch (e: any) {
    console.warn("Verification skipped/failed:", e?.message || e);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
