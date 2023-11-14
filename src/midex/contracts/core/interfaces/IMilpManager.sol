// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface IMilpManager {
    function coolDownDuration() external returns (uint256);

    function lastAddedAt(address _account) external returns (uint256);

    function addLiquidity(address _token, uint256 _amount, uint256 _minMusd, uint256 _minMilp) external;

    function removeLiquidity(address _tokenOut, uint256 _milpAmount, uint256 _minOut, address _receiver) external;

    function handlerAddLiquidity(
        address _account,
        address _receiver,
        address _token,
        uint256 _amount,
        uint256 _minMusd,
        uint256 _minMilp
    ) external returns (uint256);

    function handlerRemoveLiquidity(address _account, address _receiver, address _tokenOut, uint256 _milpAmount, uint256 _minOut) external returns (uint256);
}
