// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../interfaces/IPriceFeed.sol';
import '../interfaces/IPriceFeedStore.sol';

interface IMiOracle {
  function miOracleCall(uint256 reqId, bool priceUpdate, bytes memory payload) external;
}

contract TestUpgradeMiOracle is IPriceFeed, OwnableUpgradeable, PausableUpgradeable {
  // constants
  uint256 private constant TIMESTAMP_BITMASK = 2 ** 256 - 4;
  uint256 private constant MINIMUM_EXPIRE_TIME = 1 minutes;
  uint256 private constant DEFAULT_EXPIRE_TIME = 5 minutes;
  uint256 private constant FULFILL_FEE_PRECISION = 10000;

  // controller
  mapping(address => bool) public controller;

  // signer
  mapping(address => bool) public signers;
  uint256 public totalSigner;
  uint256 public threshold;

  // whitelist
  mapping(address => bool) public whitelists;
  bool public onlyWhitelist;

  // request store
  struct Request {
    uint256 timestamp;
    address owner;
    bytes payload;
    uint256 status; // 0 = request,  1 = fulfilled, 2 = cancel, 3 = refund
    uint256 expiration;
  }
  mapping(uint256 => Request) public requests;
  uint256 public reqId; // start with 1

  // request fee
  IERC20 public weth; // payment with WETH
  uint256 public fulfillFee;
  uint256 public minFeeBalance;

  // price feed store
  mapping(uint256 => address) public priceFeedStores;

  // Test [1/4]: added more storage
  struct Dummy {
    uint256 id;
    address owner;
  }
  mapping(uint256 => Dummy) public dummy;

  // events
  event RequestPrices(uint256 indexed reqId);
  event CancelRequestPrices(uint256 indexed reqId);
  event FulfillRequest(uint256 indexed reqId, bool success, string message);
  event TransferRequestFee(uint256 indexed _reqId, address from, address to, uint256 reqFee);
  event MiOracleCall(uint256 indexed reqId, bool success, string message);
  event RefundRequest(uint256 indexed reqId);
  event SetPriceFeedStore(address priceFeedStore, uint256 tokenIndex);
  event SetController(address controller, bool flag);
  event SetSigner(address signer, bool flag);
  event SetThreshold(uint256 threshold);
  event SetWhitelist(address whitelist, bool flag);
  event SetOnlyWhitelist(bool flag);
  event SetFulfillFee(uint256 fulfillFee);
  event SetMinFeeBalance(uint256 minFeeBalance);

  modifier onlyController() {
    require(controller[msg.sender], 'controller: forbidden');
    _;
  }

  modifier onlyContract() {
    require(msg.sender != tx.origin, 'caller: only contract');
    _;
  }

  function initialize(address _weth) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();

    require(_weth != address(0), 'address invalid');
    weth = IERC20(_weth);
  }

  // ------------------------------
  // request
  // ------------------------------
  function requestPrices(bytes memory _payload, uint256 _expiration) external onlyContract whenNotPaused returns (uint256) {
    // check allow all or only whitelist
    require(!onlyWhitelist || whitelists[msg.sender], 'whitelist: forbidden');

    // check request fee balance
    require(paymentAvailable(msg.sender), 'insufficient request fee');

    reqId++;

    // default expire time
    if (_expiration < block.timestamp + MINIMUM_EXPIRE_TIME) {
      _expiration = block.timestamp + DEFAULT_EXPIRE_TIME;
    }

    // add request
    requests[reqId] = Request({
      timestamp: markdown(block.timestamp),
      owner: msg.sender,
      payload: _payload,
      status: 0, // set status request
      expiration: _expiration
    });

    emit RequestPrices(reqId);
    return reqId;
  }

  function cancelRequestPrice(uint256 _reqId) external whenNotPaused {
    Request storage request = requests[_reqId];
    require(request.owner == msg.sender, 'not owner request');
    require(request.status == 0, 'status is not request');

    // set status cancel
    request.status = 2;

    emit CancelRequestPrices(_reqId);
  }

  // ------------------------------
  // fulfill request
  // ------------------------------
  function fulfillRequest(Data[] memory _data, uint256 _reqId) external onlyController {
    Request storage request = requests[_reqId];
    if (request.status != 0) {
      return;
    }
    // set status executed
    request.status = 1;

    require(request.owner != address(0), 'request not found');
    require(request.expiration > block.timestamp, 'request is expired');

    // capture gas used
    uint256 gasStart = gasleft();

    // set price
    (bool priceUpdate, string memory message) = setPrices(request.timestamp, _data);

    // callback
    miOracleCallback(request.owner, _reqId, priceUpdate, request.payload);

    // payment request fee
    transferRequestFee(_reqId, request.owner, gasStart - gasleft());

    emit FulfillRequest(_reqId, priceUpdate, message);
  }

  function refundRequest(uint256 _reqId) external onlyController {
    Request storage request = requests[_reqId];
    if (request.status != 0) {
      return;
    }
    // set status refund
    request.status = 3;

    // callback
    miOracleCallback(request.owner, _reqId, false, request.payload);

    emit RefundRequest(_reqId);
  }

  // ------------------------------
  // static call function
  // ------------------------------
  function estimateGasUsed(address _callback, bytes memory _payload, Data[] memory _data) external {
    uint256 timestamp = _data[0].timestamp;
    uint256 gasStart = gasleft();

    // set price
    (bool priceUpdate, string memory message) = setPrices(timestamp, _data);

    // miOracleCallback with mockup reqId = 0
    if (priceUpdate) {
      try IMiOracle(_callback).miOracleCall(0, priceUpdate, _payload) {
        // well done
      } catch Error(string memory _reason) {
        // failing revert, require
        message = _reason;
      } catch (bytes memory) {
        // failing assert
        message = 'failing assert';
      }
    }

    // calculate gas consumed and revert tx
    uint256 gasUsed = gasStart - gasleft();
    revert(string(abi.encodePacked('{"gasUsed":', StringsUpgradeable.toString(gasUsed), ',"msg":"', message, '"}')));
  }

  // ------------------------------
  // private function
  // ------------------------------
  function miOracleCallback(address _to, uint256 _reqId, bool _priceUpdate, bytes memory _payload) private {
    try IMiOracle(_to).miOracleCall(_reqId, _priceUpdate, _payload) {
      // well done
      emit MiOracleCall(_reqId, true, '');
    } catch Error(string memory _reason) {
      // failing revert, require
      emit MiOracleCall(_reqId, false, _reason);
    } catch (bytes memory) {
      // failing assert
      emit MiOracleCall(_reqId, false, 'failing assert');
    }
  }

  function setPrices(uint256 _timestamp, Data[] memory _data) private returns (bool, string memory) {
    if (_data.length == 0) {
      return (false, 'setPrices: no priceFeed data');
    }

    // find size by 8 bytes segments in prices
    uint256 size = _data[0].prices.length / 8;
    uint256[] memory tokenIndex = new uint256[](size);
    // dynamic allocate array two dimension with [prices.length] x [data.length]
    uint256[][] memory tokenIndexPrices;
    // allocate for check signer
    address[] memory validSignerAddress = new address[](_data.length);
    uint256 validSigner = 0;

    // data proof
    for (uint256 i = 0; i < _data.length; i++) {
      // check timestamp
      if (_data[i].timestamp != _timestamp) {
        return (false, 'setPrices: timestamp invalid');
      }

      // step 1: proof signature
      {
        (bool valid, address signerAddress) = validateSigner(_data[i].timestamp, _data[i].prices, _data[i].signature);
        if (!valid) {
          continue;
        }

        // check signer duplicate
        for (uint256 s = 0; s < validSigner; s++) {
          if (validSignerAddress[s] == signerAddress) {
            return (false, 'setPrices: signer duplicate');
          }
        }
        validSignerAddress[validSigner] = signerAddress;
        validSigner++;
      }

      // step 2: decode prices
      {
        Price[] memory prices = decodePrices(_data[i].prices);

        if (i == 0) {
          // allocate first dimension
          tokenIndexPrices = new uint256[][](prices.length);
        }

        // collect tokenIndex and prices
        for (uint256 j = 0; j < prices.length; j++) {
          if (i == 0) {
            // allocate second dimension
            tokenIndexPrices[j] = new uint256[](_data.length);
            // collect tokenIndex
            tokenIndex[j] = uint256(prices[j].tokenIndex);
          }

          // collect prices
          tokenIndexPrices[j][i] = uint256(prices[j].price);
        }
      }
    }

    // check signer threshold
    if (validSigner < threshold) {
      return (false, 'setPrices: signers under threshold');
    }

    // step 3: set prices to priceFeedStores
    for (uint256 i = 0; i < tokenIndex.length; i++) {
      uint256 medianPrice = getMedianPrice(tokenIndexPrices[i]);
      address priceFeed = priceFeedStores[tokenIndex[i]];
      if (priceFeed != address(0)) {
        IPriceFeedStore(priceFeed).setPrice(medianPrice, _timestamp);
      }
    }

    return (true, '');
  }

  function validateSigner(uint256 _timestamp, bytes memory _prices, bytes memory _signature) private view returns (bool, address) {
    bytes32 digest = ECDSAUpgradeable.toEthSignedMessageHash(keccak256(abi.encodePacked(_timestamp, _prices)));
    address recoveredSigner = ECDSAUpgradeable.recover(digest, _signature);
    return (signers[recoveredSigner], recoveredSigner);
  }

  function decodePrices(bytes memory _prices) private pure returns (Price[] memory) {
    // allocate by 8 bytes segments
    Price[] memory _pricesData = new Price[](_prices.length / 8);

    uint256 index = 0;
    for (uint256 i = 8; i <= _prices.length; i += 8) {
      uint16 tokenIndex;
      uint48 price;
      assembly {
        tokenIndex := mload(add(_prices, sub(i, 6))) // 2 bytes in tokenIndex
        price := mload(add(_prices, i)) // 6 bytes in price
      }

      _pricesData[index].tokenIndex = tokenIndex;
      _pricesData[index].price = price;
      index++;
    }

    return _pricesData;
  }

  function getMedianPrice(uint256[] memory prices) private pure returns (uint256) {
    // gas optimize: direct find median price without sorting array before
    uint256 size = prices.length;

    if (size % 2 == 1) {
      // odd size
      uint256 mid = (size / 2) + 1;

      for (uint256 i = 0; i < size; i++) {
        uint256 gte = 0;
        for (uint256 j = 0; j < size; j++) {
          if (prices[i] >= prices[j] && i >= j) {
            gte++;
          }
        }

        if (gte == mid) {
          return prices[i];
        }
      }
    } else {
      // even size
      uint256 mid1 = (size / 2);
      uint256 mid2 = (size / 2) + 1;
      uint256 val1;
      uint256 val2;

      for (uint256 i = 0; i < size; i++) {
        uint256 gte = 0;
        for (uint256 j = 0; j < size; j++) {
          if (prices[i] >= prices[j] && i >= j) {
            gte++;
          }
        }

        if (gte == mid1) {
          val1 = prices[i];
        } else if (gte == mid2) {
          val2 = prices[i];
        }

        if (val1 != 0 && val2 != 0) {
          break;
        }
      }

      return (val1 + val2) / 2;
    }

    // ignore warning
    return 0;
  }

  function markdown(uint256 _timestamp) private pure returns (uint256) {
    return _timestamp & TIMESTAMP_BITMASK;
  }

  function transferRequestFee(uint256 _reqId, address _from, uint256 _gasUsed) private {
    if (fulfillFee == 0) {
      return;
    }

    // calculate req fee
    uint256 reqFee = (tx.gasprice * _gasUsed * (FULFILL_FEE_PRECISION + fulfillFee)) / FULFILL_FEE_PRECISION;
    IERC20(weth).transferFrom(_from, msg.sender, reqFee);

    emit TransferRequestFee(_reqId, _from, msg.sender, reqFee);
  }

  function paymentAvailable(address _owner) private view returns (bool) {
    return (weth.allowance(_owner, address(this)) > minFeeBalance && weth.balanceOf(_owner) > minFeeBalance);
  }

  // ------------------------------
  // onlyOwner
  // ------------------------------
  // Test [2/4]: added more function
  function setDummy(uint256 _id, address _owner) external onlyOwner {
    dummy[_id] = Dummy({id: _id, owner: _owner});
  }

  function adminRefundRequest(uint256 _reqId) external onlyOwner {
    Request storage request = requests[_reqId];
    require(request.status == 0, 'status is not request');

    // set status refund
    request.status = 3;

    emit RefundRequest(_reqId);
  }

  function setPriceFeedStore(address _priceFeedStore, uint256 _tokenIndex) external onlyOwner {
    require(_priceFeedStore != address(0), 'address invalid');
    require(IPriceFeedStore(_priceFeedStore).tokenIndex() == _tokenIndex, 'tokenIndex invalid');
    priceFeedStores[_tokenIndex] = _priceFeedStore;
    emit SetPriceFeedStore(_priceFeedStore, _tokenIndex);
  }

  function setPause(bool _flag) external onlyOwner {
    (_flag) ? _pause() : _unpause();
  }

  function setController(address _controller, bool _flag) external onlyOwner {
    require(_controller != address(0), 'address invalid');
    controller[_controller] = _flag;
    emit SetController(_controller, _flag);
  }

  function setSigner(address _signer, bool _flag) external onlyOwner {
    require(_signer != address(0), 'address invalid');
    if (_flag && !signers[_signer]) {
      totalSigner++;
    } else if (!_flag && signers[_signer]) {
      totalSigner--;
      if (threshold > totalSigner) {
        threshold = totalSigner;
      }
    }

    signers[_signer] = _flag;
    emit SetSigner(_signer, _flag);
  }

  function setThreshold(uint256 _threshold) external onlyOwner {
    require(_threshold > 0 && _threshold <= totalSigner, 'threshold invalid');
    threshold = _threshold;
    emit SetThreshold(_threshold);
  }

  function setWhitelist(address _whitelist, bool _flag) external onlyOwner {
    require(_whitelist != address(0), 'address invalid');
    whitelists[_whitelist] = _flag;
    emit SetWhitelist(_whitelist, _flag);
  }

  function setOnlyWhitelist(bool _flag) external onlyOwner {
    onlyWhitelist = _flag;
    emit SetOnlyWhitelist(_flag);
  }

  function setFulfillFee(uint256 _fulfillFee) external onlyOwner {
    require(_fulfillFee < 5000, 'fulfillFee < 50%');
    fulfillFee = _fulfillFee;
    emit SetFulfillFee(_fulfillFee);
  }

  function setMinFeeBalance(uint256 _minFeeBalance) external onlyOwner {
    minFeeBalance = _minFeeBalance;
    emit SetMinFeeBalance(_minFeeBalance);
  }

  // ------------------------------
  // view function
  // ------------------------------
  // Test [3/4]: added more function
  function getPreviousPrice(uint256 _tokenIndex) external view returns (uint256, uint256, uint256, uint256) {
    uint256 roundId = IPriceFeedStore(priceFeedStores[_tokenIndex]).latestRound();
    return IPriceFeedStore(priceFeedStores[_tokenIndex]).getPrice(roundId - 1);
  }

  function getLastPrice(uint256 _tokenIndex) external view returns (uint256, uint256, uint256, uint256) {
    return IPriceFeedStore(priceFeedStores[_tokenIndex]).getLastPrice();
  }

  function getPrice(uint256 _tokenIndex, uint256 _roundId) external view returns (uint256, uint256, uint256, uint256) {
    return IPriceFeedStore(priceFeedStores[_tokenIndex]).getPrice(_roundId);
  }

  function latestRound(uint256 _tokenIndex) external view returns (uint256) {
    return IPriceFeedStore(priceFeedStores[_tokenIndex]).latestRound();
  }

  function getDecimals(uint256 _tokenIndex) external view returns (uint256) {
    return IPriceFeedStore(priceFeedStores[_tokenIndex]).decimals();
  }

  function getPriceFeed(uint256 _tokenIndex) external view returns (address) {
    return priceFeedStores[_tokenIndex];
  }

  // Test [4/4]: updated function
  function getRequest(uint256 _reqId) external view returns (uint256, address, bytes memory, uint256, uint256, uint256, bool) {
    Request memory request = requests[_reqId];
    return (
      request.timestamp,
      request.owner,
      request.payload,
      request.status,
      request.expiration,
      block.timestamp, // added current timestamp
      paymentAvailable(request.owner)
    );
  }
}
