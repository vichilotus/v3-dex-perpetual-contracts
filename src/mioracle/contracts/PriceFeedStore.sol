// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '@openzeppelin/contracts/access/Ownable.sol';

interface IChainLinkPriceFeed {
  function latestAnswer() external view returns (int256);

  function latestTimestamp() external view returns (uint256);

  function latestRound() external view returns (uint256);

  function getAnswer(uint256 roundId) external view returns (int256);

  function getTimestamp(uint256 roundId) external view returns (uint256);
}

contract PriceFeedStore is Ownable {
  address private extSource;
  address public miOracle;
  string public name;
  bool public activate;
  uint256 public tokenIndex;
  uint256 public decimals;

  // price store
  struct PriceData {
    uint256 price;
    uint256 latestPrice;
    uint256 timestamp;
  }
  mapping(uint256 => PriceData) public pricesData;
  uint256 public latestRound;
  uint256 public latestTimestamp;

  event UpdatePrice(uint256 indexed tokenIndex, uint256 roundId, uint256 price, uint256 latestPrice, uint256 timestamp);
  event SetMiOracle(address miOracle);

  modifier onlyMiOracle() {
    require(miOracle == msg.sender, 'miOracle: forbidden');
    _;
  }

  constructor(address _miOracle, string memory _name, uint256 _tokenIndex, uint256 _decimals) {
    require(_miOracle != address(0), 'address invalid');
    miOracle = _miOracle;
    name = _name;
    tokenIndex = _tokenIndex;
    decimals = _decimals;
  }

  // ------------------------------
  // miOracle setPrice
  // ------------------------------
  function setPrice(uint256 _price, uint256 _timestamp) external onlyMiOracle {
    // Sometimes the fulfill request is not in order in a short time.
    // So it's possible that the price is not the latest price.
    // _price is the fulfilling price, but latestPrice is the newest price at the time.
    uint256 latestPrice;
    if (_timestamp > latestTimestamp) {
      latestPrice = _price;
      latestTimestamp = _timestamp;
    } else {
      latestPrice = pricesData[latestRound].latestPrice;
    }

    // next round
    latestRound++;

    // already checked correct tokenIndex in miOracle.setPriceFeedStore
    pricesData[latestRound] = PriceData({price: _price, latestPrice: latestPrice, timestamp: block.timestamp});

    emit UpdatePrice(tokenIndex, latestRound, _price, latestPrice, block.timestamp);
  }

  // ------------------------------
  // onlyOwner
  // ------------------------------
  function setMiOracle(address _miOracle) external onlyOwner {
    require(_miOracle != address(0), 'address invalid');
    miOracle = _miOracle;
    emit SetMiOracle(_miOracle);
  }

  function setExternalSource(address _ext, bool _active) external onlyOwner {
    if (_ext == address(0)) require(!_active, 'Invalid Address and Activation');
    else {
      require(_active, 'Active should true');
    }
    extSource = _ext;
    activate = _active;
  }

  // ------------------------------
  // view function
  // ------------------------------
  function _getPrice(uint256 _roundId) internal view returns (uint256 _id, uint256 _price, uint256 _lastPrice, uint256 _timestamp) {
    IChainLinkPriceFeed _ext = IChainLinkPriceFeed(extSource);
    _price = uint256(_ext.getAnswer(_roundId));
    _lastPrice = uint256(_ext.latestAnswer());
    _timestamp = _ext.getTimestamp(_roundId);
    _id = _roundId;
  }

  function getLastPrice() external view returns (uint256, uint256, uint256, uint256) {
    if (activate) {
      uint256 _id = IChainLinkPriceFeed(extSource).latestRound();
      return _getPrice(_id);
    } else {
      PriceData memory priceData = pricesData[latestRound];
      return (latestRound, priceData.price, priceData.latestPrice, priceData.timestamp);
    }
  }

  function getPrice(uint256 _roundId) external view returns (uint256, uint256, uint256, uint256) {
    if (activate) {
      return _getPrice(_roundId);
    } else {
      PriceData memory priceData = pricesData[_roundId];
      return (_roundId, priceData.price, priceData.latestPrice, priceData.timestamp);
    }
  }
}
