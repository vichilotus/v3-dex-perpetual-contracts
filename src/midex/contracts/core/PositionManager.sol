// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import './interfaces/IRouter.sol';
import './interfaces/IVault.sol';
import './interfaces/IVaultPositionController.sol';
import './interfaces/IOrderBook.sol';
import './interfaces/IOrderBookOpenOrder.sol';
import '../peripherals/interfaces/ITimeLock.sol';
import './BasePositionManager.sol';

interface IFulfillController {
    function requestOracle(bytes memory _data, address _account, bytes memory _revertHandler) external;
}

contract PositionManager is BasePositionManager {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public orderBook;
    bool public inLegacyMode;
    bool public shouldValidateIncreaseOrder = true;
    uint256 public maxExecuteOrder;

    mapping(address => bool) public isOrderKeeper;
    mapping(address => bool) public isPartner;
    mapping(address => bool) public isLiquidator;
    address public fulfillController;

    event SetOrderKeeper(address indexed account, bool isActive);
    event SetLiquidator(address indexed account, bool isActive);
    event SetPartner(address account, bool isActive);
    event SetInLegacyMode(bool inLegacyMode);
    event SetShouldValidateIncreaseOrder(bool shouldValidateIncreaseOrder);

    modifier onlyOrderKeeper() {
        require(isOrderKeeper[msg.sender], 'PositionManager: forbidden');
        _;
    }

    modifier onlyLiquidator() {
        require(isLiquidator[msg.sender], 'PositionManager: forbidden');
        _;
    }

    modifier onlyPartnersOrLegacyMode() {
        require(isPartner[msg.sender] || inLegacyMode, 'PositionManager: forbidden');
        _;
    }

    modifier onlyFulfillController() {
        require(msg.sender == fulfillController, 'FulfillController: forbidden');
        _;
    }

    constructor(
        address _vault,
        address _vaultPositionController,
        address _router,
        address _weth,
        uint256 _depositFee,
        address _orderBook
    ) BasePositionManager(_vault, _vaultPositionController, _router, _weth, _depositFee) {
        orderBook = _orderBook;
    }

    function setOrderKeeper(address _account, bool _isActive) external onlyAdmin {
        isOrderKeeper[_account] = _isActive;
        emit SetOrderKeeper(_account, _isActive);
    }

    function setLiquidator(address _account, bool _isActive) external onlyAdmin {
        isLiquidator[_account] = _isActive;
        emit SetLiquidator(_account, _isActive);
    }

    function setPartner(address _account, bool _isActive) external onlyAdmin {
        isPartner[_account] = _isActive;
        emit SetPartner(_account, _isActive);
    }

    function setFulfillController(address _fulfillController) external onlyAdmin {
        require(_fulfillController != address(0), 'address invalid');
        fulfillController = _fulfillController;
    }

    function setInLegacyMode(bool _inLegacyMode) external onlyAdmin {
        inLegacyMode = _inLegacyMode;
        emit SetInLegacyMode(_inLegacyMode);
    }

    function setShouldValidateIncreaseOrder(bool _shouldValidateIncreaseOrder) external onlyAdmin {
        shouldValidateIncreaseOrder = _shouldValidateIncreaseOrder;
        emit SetShouldValidateIncreaseOrder(_shouldValidateIncreaseOrder);
    }

    function setMaxExecuteOrder(uint256 _maxExecuteOrder) external onlyAdmin {
        require(_maxExecuteOrder > 0, 'maxExecuteOrder > 0');
        maxExecuteOrder = _maxExecuteOrder;
    }

    function increasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 1 || _path.length == 2, 'PositionManager: invalid _path.length');

        if (_amountIn > 0) {
            if (_path.length == 1) {
                IRouter(router).pluginTransfer(_path[0], msg.sender, address(this), _amountIn);
            } else {
                IRouter(router).pluginTransfer(_path[0], msg.sender, vault, _amountIn);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function increasePositionETH(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 1 || _path.length == 2, 'PositionManager: invalid _path.length');
        require(_path[0] == weth, 'PositionManager: invalid _path');

        if (msg.value > 0) {
            _transferInETH();
            uint256 _amountIn = msg.value;

            if (_path.length > 1) {
                IERC20(weth).safeTransfer(vault, msg.value);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function decreasePosition(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver, _price);
    }

    function decreasePositionETH(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_collateralToken == weth, 'PositionManager: invalid _collateralToken');

        uint256 amountOut = _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        _transferOutETH(amountOut, _receiver);
    }

    function decreasePositionAndSwap(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price,
        uint256 _minOut
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, 'PositionManager: invalid _path.length');

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        _swap(_path, _minOut, _receiver);
    }

    function decreasePositionAndSwapETH(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price,
        uint256 _minOut
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, 'PositionManager: invalid _path.length');
        require(_path[_path.length - 1] == weth, 'PositionManager: invalid _path');

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        uint256 amountOut = _swap(_path, _minOut, address(this));
        _transferOutETH(amountOut, _receiver);
    }

    function executeOrders(address payable _executionFeeReceiver) external nonReentrant onlyOrderKeeper {
        // request oracle
        bytes memory data = abi.encodeWithSignature('fulfillExecuteOrders(address)', _executionFeeReceiver);
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function liquidatePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver
    ) external nonReentrant onlyLiquidator {
        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'fulfillLiquidatePosition(address,address,address,bool,address)',
            _account,
            _collateralToken,
            _indexToken,
            _isLong,
            _feeReceiver
        );
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function fulfillExecuteOrders(address payable _executionFeeReceiver) external onlyFulfillController {
        bool shouldExecute;
        uint160[] memory orderList;
        address orderBookOpenOrder = IOrderBook(orderBook).orderBookOpenOrder();
        (shouldExecute, orderList) = IOrderBookOpenOrder(orderBookOpenOrder).getShouldExecuteOrderList(false);

        if (shouldExecute) {
            uint256 orderLength = orderList.length / 3;
            if (orderLength > maxExecuteOrder) {
                orderLength = maxExecuteOrder;
            }

            uint256 curIndex = 0;

            while (curIndex < orderLength) {
                address account = address(orderList[curIndex * 3]);
                uint256 orderIndex = uint256(orderList[curIndex * 3 + 1]);
                uint256 orderType = uint256(orderList[curIndex * 3 + 2]);

                if (orderType == 0) {
                    executeSwapOrder(account, orderIndex, _executionFeeReceiver);
                } else if (orderType == 1) {
                    executeIncreaseOrder(account, orderIndex, _executionFeeReceiver);
                } else if (orderType == 2) {
                    executeDecreaseOrder(account, orderIndex, _executionFeeReceiver);
                }
                curIndex++;
            }
        }
    }

    function fulfillLiquidatePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver
    ) external onlyFulfillController {
        address _vault = vault;
        address timeLock = IVault(_vault).governor();

        ITimeLock(timeLock).enableLeverage(_vault);
        IVaultPositionController(vaultPositionController).liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
        ITimeLock(timeLock).disableLeverage(_vault);
    }

    function executeSwapOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) internal {
        IOrderBook(orderBook).executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function executeIncreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) internal {
        uint256 sizeDelta = _validateIncreaseOrder(_account, _orderIndex);

        address _vault = vault;
        address timeLock = IVault(_vault).governor();

        ITimeLock(timeLock).enableLeverage(_vault);
        IOrderBook(orderBook).executeIncreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimeLock(timeLock).disableLeverage(_vault);

        _emitIncreasePositionReferral(_account, sizeDelta);
    }

    function executeDecreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) internal /*external onlyOrderKeeper*/ {
        address _vault = vault;
        address timeLock = IVault(_vault).governor();

        (
            ,
            ,
            ,
            // _collateralToken
            // _collateralDelta
            // _indexToken
            uint256 _sizeDelta, // _isLong // triggerPrice // triggerAboveThreshold // executionFee
            ,
            ,
            ,

        ) = IOrderBook(orderBook).getDecreaseOrder(_account, _orderIndex);

        ITimeLock(timeLock).enableLeverage(_vault);
        IOrderBook(orderBook).executeDecreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimeLock(timeLock).disableLeverage(_vault);

        _emitDecreasePositionReferral(_account, _sizeDelta);
    }

    function _validateIncreaseOrder(address _account, uint256 _orderIndex) internal view returns (uint256) {
        (
            address _purchaseToken,
            uint256 _purchaseTokenAmount,
            address _collateralToken,
            address _indexToken,
            uint256 _sizeDelta,
            bool _isLong, // triggerPrice // triggerAboveThreshold // executionFee
            ,
            ,

        ) = IOrderBook(orderBook).getIncreaseOrder(_account, _orderIndex);

        if (!shouldValidateIncreaseOrder) {
            return _sizeDelta;
        }

        // shorts are okay
        if (!_isLong) {
            return _sizeDelta;
        }

        // if the position size is not increasing, this is a collateral deposit
        require(_sizeDelta > 0, 'PositionManager: long deposit');

        (uint256 size, uint256 collateral, , , , , , ) = IVaultPositionController(vaultPositionController).getPosition(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        );

        // if there is no existing position, do not charge a fee
        if (size == 0) {
            return _sizeDelta;
        }

        uint256 nextSize = size.add(_sizeDelta);
        uint256 collateralDelta = IVault(vault).tokenToUsdMin(_purchaseToken, _purchaseTokenAmount);
        uint256 nextCollateral = collateral.add(collateralDelta);

        uint256 prevLeverage = size.mul(BASIS_POINTS_DIVISOR).div(collateral);
        // allow for a maximum of a increasePositionBufferBps decrease since there might be some swap fees taken from the collateral
        uint256 nextLeverageWithBuffer = nextSize.mul(BASIS_POINTS_DIVISOR + increasePositionBufferBps).div(nextCollateral);

        require(nextLeverageWithBuffer >= prevLeverage, 'PositionManager: long leverage decrease');

        return _sizeDelta;
    }
}
