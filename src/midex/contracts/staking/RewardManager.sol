// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../access/Governable.sol';
import '../peripherals/interfaces/ITimeLock.sol';

contract RewardManager is Governable {
    bool public isInitialized;
    ITimeLock public timeLock;
    address public rewardRouter;
    address public milpManager;
    address public feeMilpTracker;

    constructor() Governable(msg.sender) {}

    function initialize(ITimeLock _timeLock, address _rewardRouter, address _milpManager, address _feeMilpTracker) external onlyGovernor {
        require(!isInitialized, 'RewardManager: already initialized');
        isInitialized = true;
        timeLock = _timeLock;
        rewardRouter = _rewardRouter;
        milpManager = _milpManager;
        feeMilpTracker = _feeMilpTracker;
    }

    function enableRewardRouter() external onlyGovernor {
        timeLock.managedSetHandler(milpManager, rewardRouter, true);
        timeLock.managedSetHandler(feeMilpTracker, rewardRouter, true);
    }
}
