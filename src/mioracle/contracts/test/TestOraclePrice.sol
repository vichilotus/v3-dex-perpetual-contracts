// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IMiOracle {
  function requestPrices(bytes memory payload, uint256 expiration) external payable returns (uint256);

  function cancelRequestPrice(uint256 _reqId) external;

  function miOracleCall(uint256 reqId, bool priceUpdate, bytes memory payload) external;

  function getLastPrice(uint256 tokenIndex) external view returns (uint256, uint256, uint256, uint256);

  function getDecimals() external pure returns (uint256);

  function reqFee() external view returns (uint256);
}

contract TestOraclePrice {
  address public miOracle;
  address public weth;

  mapping(uint256 => uint256) public tokenPrice;
  mapping(uint256 => uint256) public tokenIndex;
  uint256 public tokenIndexLength;

  constructor(address _miOracle, address _weth, uint256[] memory _tokenIndex) {
    require(_miOracle != address(0), 'address invalid');
    require(_weth != address(0), 'address invalid');
    miOracle = _miOracle;
    weth = _weth;

    tokenIndexLength = _tokenIndex.length;
    for (uint256 i = 0; i < tokenIndexLength; i++) {
      tokenIndex[i] = _tokenIndex[i];
    }
  }

  function requestUpdatePrices(uint256 _expiration) external {
    // allow to pay req fee
    IERC20(weth).approve(miOracle, type(uint256).max);
    // call with no payload
    IMiOracle(miOracle).requestPrices('', _expiration);
  }

  function cancelRequest(uint256 _reqId) external {
    IMiOracle(miOracle).cancelRequestPrice(_reqId);
  }

  // ------------------------------
  // miOracle callback
  // ------------------------------
  function miOracleCall(uint256 /* _reqId */, bool /* _priceUpdate */, bytes memory /* _payload */) external {
    // check callback
    require(msg.sender == miOracle, 'miOracleCall: only miOracle callback');

    updatePrice();
  }

  function updatePrice() private {
    for (uint256 i = 0; i < tokenIndexLength; i++) {
      uint256 _tokenIndex = tokenIndex[i];

      // get last update price
      (, /* uint256 latestRound */ uint256 price /* uint256 latestPrice */ /* uint256 timestamp */, , ) = IMiOracle(miOracle).getLastPrice(_tokenIndex);

      // update price
      tokenPrice[_tokenIndex] = price;
    }
  }

  // ------------------------------
  // view function
  // ------------------------------
  function getTokenPrice(uint256 _tokenIndex) external view returns (uint256) {
    return tokenPrice[_tokenIndex];
  }
}
