import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { UniswapV2Factory, UniswapV2Pair } from "../typechain-types";
import { getCreate2Address } from "./shared/utilities";

const TEST_ADDRESSES: [string, string] = [
  "0x1000000000000000000000000000000000000000",
  "0x2000000000000000000000000000000000000000",
];

describe("UniswapV2Factory", () => {
  async function fixture() {
    const tmp = await ethers.getContractFactory("UniswapV2Factory");
    const [wallet, other] = await ethers.getSigners();
    const factory = await tmp.deploy(wallet.address);
    return { factory, wallet, other };
  }

  it("feeTo, feeToSetter, allPairsLength", async () => {
    const { factory, wallet } = await loadFixture(fixture);
    expect(await factory.feeTo()).to.eq(ethers.ZeroAddress);
    expect(await factory.feeToSetter()).to.eq(wallet.address);
    expect(await factory.allPairsLength()).to.eq(0);
  });

  async function createPair(
    factory: UniswapV2Factory,
    tokens: [string, string],
  ) {
    const pairContract = await ethers.getContractFactory("UniswapV2Pair");
    const factoryAddress = await factory.getAddress();
    const create2Address = getCreate2Address(
      factoryAddress,
      tokens,
      pairContract.bytecode,
    );
    await expect(factory.createPair(tokens[0], tokens[1]))
      .to.emit(factory, "PairCreated")
      .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1);

    await expect(factory.createPair(tokens[0], tokens[1])).to.be.reverted; // UniswapV2: PAIR_EXISTS
    await expect(factory.createPair(tokens[1], tokens[0])).to.be.reverted; // UniswapV2: PAIR_EXISTS
    expect(await factory.getPair(tokens[0], tokens[1])).to.eq(create2Address);
    expect(await factory.getPair(tokens[1], tokens[0])).to.eq(create2Address);
    expect(await factory.allPairs(0)).to.eq(create2Address);
    expect(await factory.allPairsLength()).to.eq(1);

    const pair = pairContract.attach(create2Address) as UniswapV2Pair;
    expect(await pair.factory()).to.eq(factoryAddress);
    expect(await pair.token0()).to.eq(TEST_ADDRESSES[0]);
    expect(await pair.token1()).to.eq(TEST_ADDRESSES[1]);
  }

  it("Pair:codeHash", async () => {
    const { factory } = await loadFixture(fixture);
    const codehash = await factory.PAIR_HASH();
    // const pair = await ethers.getContractFactory("UniswapV2Pair");
    // expect(ethers.utils.keccak256(pair.bytecode)).to.be.eq(codehash);
    expect(codehash).to.be.eq(
      "0x64028021862e7517455071eea332cd936a31538a81db5332acecf4efd7106a8b",
    );
  });

  it("createPair", async () => {
    const { factory } = await loadFixture(fixture);
    await createPair(factory, [...TEST_ADDRESSES]);
  });

  it("createPair:reverse", async () => {
    const { factory } = await loadFixture(fixture);
    await createPair(
      factory,
      TEST_ADDRESSES.slice().reverse() as [string, string],
    );
  });

  it("createPair:gas", async () => {
    const { factory } = await loadFixture(fixture);
    const tx = await factory.createPair(...TEST_ADDRESSES);
    const receipt = await tx.wait();
    expect(receipt!.gasUsed).to.eq(2341696);
  });

  it("setFeeTo", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(
      factory.connect(other).setFeeTo(other.address),
    ).to.be.revertedWith("UniswapV2: FORBIDDEN");
    await factory.setFeeTo(wallet.address);
    expect(await factory.feeTo()).to.eq(wallet.address);
  });

  it("setFeeToSetter", async () => {
    const { factory, wallet, other } = await loadFixture(fixture);
    await expect(
      factory.connect(other).setFeeToSetter(other.address),
    ).to.be.revertedWith("UniswapV2: FORBIDDEN");
    await factory.setFeeToSetter(other.address);
    expect(await factory.feeToSetter()).to.eq(other.address);
    await expect(factory.setFeeToSetter(wallet.address)).to.be.revertedWith(
      "UniswapV2: FORBIDDEN",
    );
  });
});
