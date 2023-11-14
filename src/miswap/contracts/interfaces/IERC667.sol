// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.20;

interface ITransferReceiver {
    function onTokenTransfer(address, uint, bytes calldata) external returns (bool);
}

interface IApprovalReceiver {
    function onTokenApproval(address, uint, bytes calldata) external returns (bool);
}
