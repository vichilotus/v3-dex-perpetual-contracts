// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IMiOracle {
  function requestPrices(bytes memory payload, uint256 expiration) external payable returns (uint256);

  function miOracleCall(uint256 reqId, bool priceUpdate, bytes memory payload) external;

  function getLastPrice(uint256 tokenIndex) external view returns (uint256, uint256, uint256, uint256);
}

// ------------------------------
// RequestPrices
// a simple contract to request price from miOracle
// ------------------------------
contract RequestPrices {
  // miOracle
  address public miOracle;
  address public weth;

  modifier onlyMiOracle() {
    require(msg.sender == miOracle, 'miOracleCall: only miOracle callback');
    _;
  }

  constructor(address _miOracle, address _weth) {
    miOracle = _miOracle;
    weth = _weth;
  }

  // Request oracle prices
  function requestPrices() external {
    // allowance req fee
    IERC20(weth).approve(miOracle, type(uint256).max);

    // make payload and call
    bytes memory payload = ''; // no payload
    uint256 expiration = 0; // no expired
    IMiOracle(miOracle).requestPrices(payload, expiration);
  }

  // ------------------------------
  // miOracle callback
  // ------------------------------
  function miOracleCall(uint256 /* _reqId */, bool /* _priceUpdate */, bytes memory /* _payload */) external onlyMiOracle {
    // do nothing
    // ...
  }

  // ------------------------------
  // view function
  // ------------------------------
  function getPrice(uint256 _tokenIndex) external view returns (uint256) {
    // get last update price
    (, uint256 price, , ) = IMiOracle(miOracle).getLastPrice(_tokenIndex);
    return price;
  }
}
