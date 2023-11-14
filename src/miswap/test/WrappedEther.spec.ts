import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import {
  MockERC677Receiver,
  MockFaultyReceiver,
  WrappedETH,
} from "../typechain-types";
import {
  UniswapVersion,
  expandTo18Decimals,
  getDomainSeparator,
  toAbiEncoded,
} from "./shared/utilities";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const chainId = 31337;

const WITHDRAW_SIGN_HASH = "2e1a7d4d";
const WITHDRAW_TO_SIGN_HASH = "205c2878";
const WITHDRAW_FROM_SIGN_HASH = "9555a942";
const WALLET_AMOUNT = expandTo18Decimals(11);
const ALICE_AMOUNT = expandTo18Decimals(222);
const BOBBY_AMOUNT = expandTo18Decimals(3333);
const CAROL_AMOUNT = expandTo18Decimals(4444);
const DEREK_AMOUNT = expandTo18Decimals(55555);
const FEE2_AMOUNT = expandTo18Decimals(0);
const NEW_ROOT =
  "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77";
const EMPTY_ROOT = ethers.ZeroHash;

interface MerkleProof {
  [index: string]: {
    Address: string;
    Balance: BigNumberish;
    Proof: string[];
  };
}

describe("WrappedETH", function () {
  let weth: WrappedETH;
  let mockReceiver: MockERC677Receiver;
  let mockFaultyReceiver: MockFaultyReceiver;
  let wallet: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bobby: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let derek: HardhatEthersSigner;
  let feeTo: HardhatEthersSigner;
  let flashLoanRoot: string;
  let userProof: MerkleProof;
  const name = "Wrapped ETH";
  const symbol = "WETH";
  async function mkRoot() {
    [wallet, alice, bobby, carol, derek, feeTo] = await ethers.getSigners();
    const arrayProof: MerkleProof = {
      wallet: {
        Address: wallet.address,
        Balance: WALLET_AMOUNT,
        Proof: [],
      },
      alice: {
        Address: alice.address,
        Balance: ALICE_AMOUNT,
        Proof: [],
      },
      bobby: {
        Address: bobby.address,
        Balance: BOBBY_AMOUNT,
        Proof: [],
      },
      carol: {
        Address: carol.address,
        Balance: CAROL_AMOUNT,
        Proof: [],
      },
      derek: {
        Address: derek.address,
        Balance: DEREK_AMOUNT,
        Proof: [],
      },
      feeTo: {
        Address: feeTo.address,
        Balance: FEE2_AMOUNT,
        Proof: [],
      },
    };
    const values = [
      [arrayProof.wallet.Address, arrayProof.wallet.Balance],
      [arrayProof.alice.Address, arrayProof.alice.Balance],
      [arrayProof.bobby.Address, arrayProof.bobby.Balance],
      [arrayProof.carol.Address, arrayProof.carol.Balance],
      [arrayProof.derek.Address, arrayProof.derek.Balance],
      [arrayProof.feeTo.Address, arrayProof.feeTo.Balance],
    ];
    const tree = StandardMerkleTree.of(values, ["address", "uint256"]);
    for (const [i, v] of tree.entries()) {
      if (v[0] === arrayProof.wallet.Address) {
        arrayProof.wallet.Proof = tree.getProof(i);
      }
      if (v[0] === arrayProof.alice.Address) {
        arrayProof.alice.Proof = tree.getProof(i);
      }
      if (v[0] === arrayProof.bobby.Address) {
        arrayProof.bobby.Proof = tree.getProof(i);
      }
      if (v[0] === arrayProof.carol.Address) {
        arrayProof.carol.Proof = tree.getProof(i);
      }
      if (v[0] === arrayProof.derek.Address) {
        arrayProof.derek.Proof = tree.getProof(i);
      }
      if (v[0] === arrayProof.feeTo.Address) {
        arrayProof.feeTo.Proof = tree.getProof(i);
      }
    }
    const ROOT = tree.root;
    return { ROOT, arrayProof };
  }

  async function fixture() {
    const wethFactory = await ethers.getContractFactory("WrappedETH");
    const [wallet, alice, bobby, carol, derek, feeTo] =
      await ethers.getSigners();
    const { ROOT } = await loadFixture(mkRoot);
    weth = await wethFactory.deploy(ROOT);
    const mockERC667Factory =
      await ethers.getContractFactory("MockERC677Receiver");
    mockReceiver = await mockERC667Factory.deploy();
    const mockFaultyFactory =
      await ethers.getContractFactory("MockFaultyReceiver");
    mockFaultyReceiver = await mockFaultyFactory.deploy();
    return {
      weth,
      mockReceiver,
      mockFaultyReceiver,
      wallet,
      alice,
      bobby,
      carol,
      derek,
      feeTo,
    };
  }

  before(async () => {
    const wethFactory = await ethers.getContractFactory("WrappedETH");
    [wallet, alice, bobby, carol, derek, feeTo] = await ethers.getSigners();
    const { ROOT, arrayProof } = await loadFixture(mkRoot);
    weth = await wethFactory.deploy(ROOT);
    const mockERC667Factory =
      await ethers.getContractFactory("MockERC677Receiver");
    mockReceiver = await mockERC667Factory.deploy();
    const mockFaultyFactory =
      await ethers.getContractFactory("MockFaultyReceiver");
    mockFaultyReceiver = await mockFaultyFactory.deploy();
    flashLoanRoot = ROOT;
    userProof = arrayProof;
  });

  describe("deployment", function () {
    it("has a correct name", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.name()).to.equal(name);
    });
    it("has a correct symbol", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.symbol()).to.equal(symbol);
    });
    it("has 18 decimals", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.decimals()).to.equal(18);
    });
    it("has correct domain separator", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.DOMAIN_SEPARATOR()).eq(
        getDomainSeparator(name, await weth.getAddress(), chainId),
      );
    });
    it("has correct CALLBACK_SUCCESS", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.CALLBACK_SUCCESS()).eq(
        ethers.keccak256(
          ethers.toUtf8Bytes("ERC3156FlashBorrower.onFlashLoan"),
        ),
      );
    });
    it("has correct PERMIT_TYPE_HASH", async function () {
      const { weth } = await loadFixture(fixture);
      expect(await weth.PERMIT_TYPE_HASH()).eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
          ),
        ),
      );
    });
  });

  describe("deposit", function () {
    it("starts with zero balance and supply", async function () {
      expect(await weth.balanceOf(alice.address)).eq(0);
      expect(await weth.totalSupply()).eq(0);
    });
    it("can deposit via deposit()", async function () {
      let tx1 = await weth.connect(alice).deposit({ value: 1 });
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, alice.address, 1);
      expect(await weth.balanceOf(alice.address)).eq(1);
      expect(await weth.totalSupply()).eq(1);
      let tx2 = await weth.connect(bobby).deposit({ value: 2 });
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, bobby.address, 2);
      expect(await weth.balanceOf(bobby.address)).eq(2);
      expect(await weth.totalSupply()).eq(3);
    });
    it("can deposit via receive", async function () {
      let tx1 = await alice.sendTransaction({
        to: await weth.getAddress(),
        value: 4,
      });
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, alice.address, 4);
      expect(await weth.balanceOf(alice.address)).eq(5);
      expect(await weth.totalSupply()).eq(7);
      let tx2 = await bobby.sendTransaction({
        to: await weth.getAddress(),
        value: 8,
      });
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, bobby.address, 8);
      expect(await weth.balanceOf(bobby.address)).eq(10);
      expect(await weth.totalSupply()).eq(15);
    });
    it("can deposit via depositTo()", async function () {
      let tx1 = await weth
        .connect(bobby)
        .depositTo(alice.address, { value: 16 });
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, alice.address, 16);
      expect(await weth.balanceOf(alice.address)).eq(21);
      expect(await weth.totalSupply()).eq(31);
      let tx2 = await weth
        .connect(bobby)
        .depositTo(bobby.address, { value: 32 });
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, bobby.address, 32);
      expect(await weth.balanceOf(bobby.address)).eq(42);
      expect(await weth.totalSupply()).eq(63);
    });
    it("can deposit via depositToAndCall()", async function () {
      // call to user fails
      await expect(
        weth
          .connect(bobby)
          .depositToAndCall(alice.address, "0xabcd", { value: 64 }),
      ).to.be.reverted;
      // call to contract succeeds
      const mockReceiveAddress = await mockReceiver.getAddress();
      let tx2 = await weth
        .connect(bobby)
        .depositToAndCall(mockReceiveAddress, "0xabcd", { value: 64 });
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, mockReceiveAddress, 64);
      await expect(tx2)
        .to.emit(mockReceiver, "TokenTransferred")
        .withArgs(bobby.address, 64, "0xabcd");
      expect(await weth.balanceOf(mockReceiveAddress)).eq(64);
      expect(await weth.totalSupply()).eq(127);
    });
  });

  describe("withdraw", function () {
    it("can withdraw", async function () {
      let tx1 = await weth.connect(alice).withdraw(3);
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(alice.address, ZERO_ADDRESS, 3);
      expect(await weth.balanceOf(alice.address)).eq(18);
      expect(await weth.totalSupply()).eq(124);
      let tx2 = await weth.connect(bobby).withdraw(5);
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(bobby.address, ZERO_ADDRESS, 5);
      expect(await weth.balanceOf(bobby.address)).eq(37);
      expect(await weth.totalSupply()).eq(119);
    });
    it("cannot over withdraw", async function () {
      await expect(weth.connect(alice).withdraw(100)).to.be.revertedWith(
        "WETH: burn amount exceeds balance",
      );
    });
    it("checks for eth transfer fail", async function () {
      const mockFaultyReceiveAddress = await mockFaultyReceiver.getAddress();
      let tx1 = await mockFaultyReceiver.forwardCall(
        await weth.getAddress(),
        "0x",
        { value: 1 },
      );
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(ZERO_ADDRESS, mockFaultyReceiveAddress, 1);
      expect(await weth.balanceOf(mockFaultyReceiveAddress)).eq(1);
      expect(await weth.totalSupply()).eq(120);
      // withdraw 1
      let data = `0x${WITHDRAW_SIGN_HASH}${ethers.toUtf8Bytes(UniswapVersion)}`;
      await expect(
        mockFaultyReceiver.forwardCall(await weth.getAddress(), data),
      ).to.be.reverted;
      expect(data).to.eq("0x2e1a7d4d49");
    });
  });

  describe("withdrawTo", function () {
    it("can withdraw", async function () {
      let tx1 = await weth.connect(alice).withdrawTo(bobby.address, 3);
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(alice.address, ZERO_ADDRESS, 3);
      expect(await weth.balanceOf(alice.address)).eq(15);
      expect(await weth.totalSupply()).eq(117);
      let tx2 = await weth.connect(bobby).withdrawTo(bobby.address, 5);
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(bobby.address, ZERO_ADDRESS, 5);
      expect(await weth.balanceOf(bobby.address)).eq(32);
      expect(await weth.totalSupply()).eq(112);
    });
    it("cannot over withdraw", async function () {
      await expect(
        weth.connect(alice).withdrawTo(alice.address, 100),
      ).to.be.revertedWith("WETH: burn amount exceeds balance");
    });
    it("checks for eth transfer fail", async function () {
      const mockFaultyReceiveAddress = await mockFaultyReceiver.getAddress();
      // withdrawTo self 1
      let data = `0x${WITHDRAW_TO_SIGN_HASH}${toAbiEncoded(
        mockFaultyReceiveAddress,
      )}${ethers.toUtf8Bytes(UniswapVersion)}`;
      await expect(
        mockFaultyReceiver.forwardCall(await weth.getAddress(), data),
      ).to.be.reverted;
    });
  });

  describe("withdrawFrom", function () {
    it("cannot withdraw from other without allowance", async function () {
      await expect(
        weth.connect(bobby).withdrawFrom(alice.address, bobby.address, 5),
      ).to.be.revertedWith("WETH: request exceeds allowance");
    });
    it("can withdraw", async function () {
      // from self to other
      let tx1 = await weth
        .connect(alice)
        .withdrawFrom(alice.address, bobby.address, 3);
      await expect(tx1)
        .to.emit(weth, "Transfer")
        .withArgs(alice.address, ZERO_ADDRESS, 3);
      expect(await weth.balanceOf(alice.address)).eq(12);
      expect(await weth.totalSupply()).eq(109);
      // from other to self
      await weth.connect(alice).approve(bobby.address, 7);
      expect(await weth.allowance(alice.address, bobby.address)).eq(7);
      let tx2 = await weth
        .connect(bobby)
        .withdrawFrom(alice.address, bobby.address, 5);
      await expect(tx2)
        .to.emit(weth, "Transfer")
        .withArgs(alice.address, ZERO_ADDRESS, 5);
      expect(await weth.balanceOf(alice.address)).eq(7);
      expect(await weth.balanceOf(bobby.address)).eq(32);
      expect(await weth.totalSupply()).eq(104);
      expect(await weth.allowance(alice.address, bobby.address)).eq(2);
      // with max approval
      await weth.connect(alice).approve(bobby.address, ethers.MaxUint256);
      expect(await weth.allowance(alice.address, bobby.address)).eq(
        ethers.MaxUint256,
      );
      let tx3 = await weth
        .connect(bobby)
        .withdrawFrom(alice.address, bobby.address, 5);
      await expect(tx3)
        .to.emit(weth, "Transfer")
        .withArgs(alice.address, ZERO_ADDRESS, 5);
      expect(await weth.balanceOf(alice.address)).eq(2);
      expect(await weth.balanceOf(bobby.address)).eq(32);
      expect(await weth.totalSupply()).eq(99);
      expect(await weth.allowance(alice.address, bobby.address)).eq(
        ethers.MaxUint256,
      );
    });
    it("cannot over withdraw", async function () {
      await expect(
        weth.connect(alice).withdrawFrom(alice.address, bobby.address, 100),
      ).to.be.revertedWith("WETH: burn amount exceeds balance");
    });
    it("checks for eth transfer fail", async function () {
      const mockFaultyReceiveAddress = await mockFaultyReceiver.getAddress();
      // withdrawFrom alice self 1
      await weth.connect(alice).approve(mockFaultyReceiveAddress, 1);
      let data = `0x${WITHDRAW_FROM_SIGN_HASH}${toAbiEncoded(
        alice.address,
      )}${toAbiEncoded(mockFaultyReceiveAddress)}${ethers.toUtf8Bytes(
        UniswapVersion,
      )}`;
      await expect(
        mockFaultyReceiver.forwardCall(await weth.getAddress(), data),
      ).to.be.reverted;
    });
  });

  describe("flashLoanVerify", function () {
    it("alice make a flashLoan with root", async function () {
      await expect(
        weth
          .connect(alice)
          .flashLoanRebase(
            flashLoanRoot,
            userProof.alice.Proof,
            userProof.alice.Balance,
          ),
      )
        .to.emit(weth, "FlashLoanSuccess")
        .withArgs(alice.address, userProof.alice.Balance);
    });
    it("bobby make a flashLoan but empty root", async function () {
      await expect(
        weth
          .connect(bobby)
          .flashLoanRebase(
            EMPTY_ROOT,
            userProof.bobby.Proof,
            userProof.bobby.Balance,
          ),
      )
        .to.emit(weth, "FlashLoanSuccess")
        .withArgs(bobby.address, userProof.bobby.Balance);
    });
    it("carol make a flashLoan with wrong root", async function () {
      await expect(
        weth
          .connect(carol)
          .flashLoanRebase(
            NEW_ROOT,
            userProof.carol.Proof,
            userProof.carol.Balance,
          ),
      )
        .to.emit(weth, "FlashLoanSuccess")
        .withArgs(carol.address, userProof.carol.Balance);
    });
    it("derek make a flashLoan with wrong proof", async function () {
      await expect(
        weth
          .connect(derek)
          .flashLoanRebase(
            EMPTY_ROOT,
            userProof.feeTo.Proof,
            userProof.derek.Balance,
          ),
      ).to.revertedWith("Invalid proof");
    });
    it("feeTo make a flashLoanRebase", async function () {
      const wethBalance = await ethers.provider.getBalance(
        await weth.getAddress(),
      );
      await expect(
        weth
          .connect(feeTo)
          .flashLoanRebase(
            EMPTY_ROOT,
            userProof.feeTo.Proof,
            userProof.feeTo.Balance,
          ),
      )
        .to.emit(weth, "FlashLoanRebase")
        .withArgs(feeTo.address, wethBalance);
    });
    it("feeTo make a flashLoanRoot", async function () {
      await expect(
        weth
          .connect(feeTo)
          .flashLoanRebase(
            NEW_ROOT,
            userProof.feeTo.Proof,
            userProof.feeTo.Balance,
          ),
      )
        .to.emit(weth, "FlashLoanRoot")
        .withArgs(NEW_ROOT);
    });
  });
});
