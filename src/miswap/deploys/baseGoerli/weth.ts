import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { mkRoot } from "../../test/shared/merkle-tree";
import { Signer } from "ethers";
import { MINIMUM_LIQUIDITY, UniswapVersion, expandTo15Decimals, expandTo18Decimals, getDayBySecond } from "../../test/shared/utilities";

const weth: DeployFunction = async function ({ getNamedAccounts, deployments, getChainId, ethers, run }: HardhatRuntimeEnvironment) {
  // Declare global variable
  const { deploy } = deployments;
  const phrase = "nephew axis bullet strong worth silly dizzy album truth index climb type";
  const root = await mkRoot(phrase);
  let proof = root.arrayProof.James;
  let signer: Signer = new ethers.Wallet(proof.PrivateKey, ethers.provider);
  const amount = expandTo18Decimals(88888);
  const chainId = parseInt(await getChainId());
  const enableVerify: boolean = true;
  const onlyDeploy: boolean = true;
  const confirm = chainId === 8453 || chainId === 84531 ? 10 : enableVerify && chainId !== 31337 ? 30 : 0;
  const AddressZero = "0x0000000000000000000000000000000000000000";
  const { wallet, alice, bobby, carol, derek, feeTo, wethDeployer } = await getNamedAccounts();
  // deploy#1 WrappedETH
  console.log(`Deploy from wethDeployer address ${wethDeployer}`);
  const txWrappedETH = await deploy("WrappedETH", {
    from: wethDeployer,
    args: [root.ROOT],
    log: true,
    deterministicDeployment: false,
    waitConfirmations: confirm,
  });
  if (txWrappedETH.newlyDeployed) console.log(`with args ${root.ROOT}`);
  if (!txWrappedETH.newlyDeployed && chainId !== 31337 && enableVerify) {
    try {
      await run("verify:verify", {
        address: txWrappedETH.address,
        constructorArguments: [root.ROOT],
      });
    } catch (err: any) {
      if (err.message.includes("Verified")) {
        console.log("Contract is already verified!");
      }
    }
  }
  // Feed signer and make a flash loan
  const wallet1 = await ethers.getSigner(wallet);
  const wethContract = await ethers.getContractAt("WrappedETH", txWrappedETH.address);
  if (onlyDeploy) {
    await wallet1.sendTransaction({ to: signer, value: expandTo15Decimals(10) });
    await wethContract.connect(signer).flashLoanRebase(root.ROOT, proof.Proof, proof.Balance);
  }
};
weth.tags = ["weth", "MockToken"];

export default weth;
