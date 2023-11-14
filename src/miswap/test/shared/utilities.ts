//import { ethers } from "ethers";
import { ethers } from "hardhat";

export async function advanceBlock() {
  return ethers.provider.send("evm_mine", []);
}

export async function advanceBlockTo(blockNumber: number) {
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock();
  }
}

export function expandTo18Decimals(n: number): bigint {
  return BigInt(n) * 10n ** 18n;
}
export function expandTo15Decimals(n: number): bigint {
  return BigInt(n) * 10n ** 15n;
}
export function exp13(n: number): bigint {
  return BigInt(n) * 10n ** 13n;
}
export function getDayBySecond(n: number): bigint {
  return BigInt(n) * 24n * 60n * 60n;
}
// returns a number in its full 32 byte hex representation
export function toBytes32(str: string) {
  return ethers.hexlify(ethers.zeroPadBytes(str, 32));
}

// same as above without leading 0x
export function toAbiEncoded(str: string) {
  return toBytes32(str).substring(2);
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  bytecode: string,
): string {
  const [token0, token1] =
    tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.keccak256(
      ethers.solidityPacked(["address", "address"], [token0, token1]),
    ),
    ethers.keccak256(bytecode),
  );
}

// works for ERC20s, not ERC721s
export const PERMIT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
  ),
);

// Gets the EIP712 domain separator
export function getDomainSeparator(
  name: string,
  contractAddress: string,
  chainId: number,
) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        ethers.keccak256(ethers.toUtf8Bytes(name)),
        ethers.keccak256(ethers.toUtf8Bytes("1")),
        chainId,
        contractAddress,
      ],
    ),
  );
}

export function encodePrice(reserve0: bigint, reserve1: bigint) {
  return [
    (reserve1 * 2n ** 112n) / reserve0,
    (reserve0 * 2n ** 112n) / reserve1,
  ];
}

export const MINIMUM_LIQUIDITY = 10n ** 3n;

export const UniswapVersion = "1";
