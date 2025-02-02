// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import './interfaces/IVault.sol';
import '../access/Governable.sol';

contract VaultErrorController is Governable {
    constructor() Governable(msg.sender) {}

    function setErrors(IVault _vault, string[] calldata _errors) external onlyGovernor {
        for (uint256 i = 0; i < _errors.length; i++) {
            _vault.setError(i, _errors[i]);
        }
    }
}
