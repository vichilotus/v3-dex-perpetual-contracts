import { StandardMerkleTree } from '@openzeppelin/merkle-tree'
import { ethers } from 'ethers'
export function expandTo18Decimals(n: number): bigint {
  return BigInt(n) * 10n ** 18n
}
export interface MerkleProof {
  [index: string]: {
    Address: string
    Balance: bigint
    Proof: string[]
    PrivateKey: string
  }
}
export async function mkRoot(phrase: string) {
  const James_ = expandTo18Decimals(1111)
  const Robert_ = expandTo18Decimals(2212)
  const John_ = expandTo18Decimals(3333)
  const Michael_ = expandTo18Decimals(4444)
  const David_ = expandTo18Decimals(5555)
  const William_ = expandTo18Decimals(6666)
  const Richard_ = expandTo18Decimals(7777)
  const Joseph_ = expandTo18Decimals(8888)
  const Thomas_ = expandTo18Decimals(9999)
  const Christopher_ = expandTo18Decimals(10000)
  const hdWallet = ethers.HDNodeWallet.fromPhrase(phrase)
  const James = hdWallet.deriveChild(1)
  const Robert = hdWallet.deriveChild(2)
  const John = hdWallet.deriveChild(3)
  const Michael = hdWallet.deriveChild(4)
  const David = hdWallet.deriveChild(5)
  const William = hdWallet.deriveChild(6)
  const Richard = hdWallet.deriveChild(7)
  const Joseph = hdWallet.deriveChild(8)
  const Thomas = hdWallet.deriveChild(9)
  const Christopher = hdWallet.deriveChild(10)
  const arrayProof: MerkleProof = {
    James: {
      Address: James.address,
      Balance: James_,
      Proof: [],
      PrivateKey: James.privateKey,
    },
    Robert: {
      Address: Robert.address,
      Balance: Robert_,
      Proof: [],
      PrivateKey: Robert.privateKey,
    },
    John: {
      Address: John.address,
      Balance: John_,
      Proof: [],
      PrivateKey: John.privateKey,
    },
    Michael: {
      Address: Michael.address,
      Balance: Michael_,
      Proof: [],
      PrivateKey: Michael.privateKey,
    },
    David: {
      Address: David.address,
      Balance: David_,
      Proof: [],
      PrivateKey: David.privateKey,
    },
    William: {
      Address: William.address,
      Balance: William_,
      Proof: [],
      PrivateKey: William.privateKey,
    },
    Richard: {
      Address: Richard.address,
      Balance: Richard_,
      Proof: [],
      PrivateKey: Richard.privateKey,
    },
    Joseph: {
      Address: Joseph.address,
      Balance: Joseph_,
      Proof: [],
      PrivateKey: Joseph.privateKey,
    },
    Thomas: {
      Address: Thomas.address,
      Balance: Thomas_,
      Proof: [],
      PrivateKey: Thomas.privateKey,
    },
    Christopher: {
      Address: Christopher.address,
      Balance: Christopher_,
      Proof: [],
      PrivateKey: Christopher.privateKey,
    },
  }
  const values = [
    [arrayProof.James.Address, arrayProof.James.Balance],
    [arrayProof.Robert.Address, arrayProof.Robert.Balance],
    [arrayProof.John.Address, arrayProof.John.Balance],
    [arrayProof.Michael.Address, arrayProof.Michael.Balance],
    [arrayProof.David.Address, arrayProof.David.Balance],
    [arrayProof.William.Address, arrayProof.William.Balance],
    [arrayProof.Richard.Address, arrayProof.Richard.Balance],
    [arrayProof.Joseph.Address, arrayProof.Joseph.Balance],
    [arrayProof.Thomas.Address, arrayProof.Thomas.Balance],
    [arrayProof.Christopher.Address, arrayProof.Christopher.Balance],
  ]
  const tree = StandardMerkleTree.of(values, ['address', 'uint256'])
  for (const [i, v] of tree.entries()) {
    if (v[0] === arrayProof.James.Address) {
      arrayProof.James.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Robert.Address) {
      arrayProof.Robert.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.John.Address) {
      arrayProof.John.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Michael.Address) {
      arrayProof.Michael.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.David.Address) {
      arrayProof.David.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.William.Address) {
      arrayProof.William.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Richard.Address) {
      arrayProof.Richard.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Joseph.Address) {
      arrayProof.Joseph.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Thomas.Address) {
      arrayProof.Thomas.Proof = tree.getProof(i)
    }
    if (v[0] === arrayProof.Christopher.Address) {
      arrayProof.Christopher.Proof = tree.getProof(i)
    }
  }
  const ROOT = tree.root
  return { ROOT, arrayProof }
}
