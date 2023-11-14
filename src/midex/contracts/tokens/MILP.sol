// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../tokens/MintableBaseToken.sol';

contract MILP is MintableBaseToken {
    constructor() MintableBaseToken('TFX LP', 'MILP', 0) {}

    function id() external pure returns (string memory _name) {
        return 'MILP';
    }
}
