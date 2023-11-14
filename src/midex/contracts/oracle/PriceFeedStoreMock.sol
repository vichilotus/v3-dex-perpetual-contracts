// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '@openzeppelin/contracts/access/Ownable.sol';

// This contract is mockup for testing
// [DO NOT USE ON PRODUCTION]
//
contract PriceFeedStoreMock is Ownable {
    address public miOracle;
    string public name;
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
        latestRound++;
        pricesData[latestRound] = PriceData({price: _price, latestPrice: _price, timestamp: _timestamp});
    }

    // ------------------------------
    // view function
    // ------------------------------
    function getLastPrice() external view returns (uint256, uint256, uint256, uint256) {
        PriceData memory priceData = pricesData[latestRound];
        return (latestRound, priceData.price, priceData.latestPrice, priceData.timestamp);
    }

    function getPrice(uint256 _roundId) external view returns (uint256, uint256, uint256, uint256) {
        PriceData memory priceData = pricesData[_roundId];
        return (_roundId, priceData.price, priceData.latestPrice, priceData.timestamp);
    }
}
