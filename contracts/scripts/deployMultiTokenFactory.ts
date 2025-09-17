import { ethers, network, run } from "hardhat";

async function main() {
  console.log(`Network: ${network.name}`);
  const Factory = await ethers.getContractFactory("MultiTokenTimelockFactory");
  const factory = await Factory.deploy();
  const addr = await factory.getAddress();
  console.log("MultiTokenTimelockFactory deployed at:", addr);

  if (network.name !== "hardhat") {
    console.log("Verifying on explorer...");
    try {
      await run("verify:verify", { address: addr, constructorArguments: [] });
      console.log("Verified successfully.");
    } catch (e: any) {
      console.error("Verification skipped/failed:", e?.message || e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


