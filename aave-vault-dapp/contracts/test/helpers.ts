import { ethers } from "hardhat";
import { Signer } from "ethers";

export async function timeTravel(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export async function getCurrentTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block?.timestamp || Math.floor(Date.now() / 1000);
}

export async function getFutureTimestamp(hours: number = 24): Promise<number> {
  const currentTime = await getCurrentTimestamp();
  return currentTime + (hours * 3600);
}

export async function getSigners(): Promise<[Signer, Signer, Signer]> {
  const [owner, user1, user2] = await ethers.getSigners();
  return [owner, user1, user2];
}

export async function getAddresses(signers: Signer[]): Promise<string[]> {
  return Promise.all(signers.map(signer => signer.getAddress()));
}
