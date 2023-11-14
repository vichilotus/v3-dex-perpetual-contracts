// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface ITimeLock {
    function setAdmin(address _admin) external;

    function enableLeverage(address _vault) external;

    function disableLeverage(address _vault) external;

    function setIsLeverageEnabled(address _vault, bool _isLeverageEnabled) external;

    function signalTransferGovernance(address _target, address _governor) external;

    function managedSetHandler(address _target, address _handler, bool _isActive) external;

    function managedSetMinter(address _target, address _minter, bool _isActive) external;
}
