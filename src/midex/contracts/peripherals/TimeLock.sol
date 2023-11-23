// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../libraries/math/SafeMath.sol';
import '../libraries/token/IERC20.sol';
import './interfaces/ITimeLockTarget.sol';
import './interfaces/ITimeLock.sol';
import './interfaces/IHandlerTarget.sol';
import '../access/interfaces/IAdmin.sol';
import '../core/interfaces/IVault.sol';
import '../core/interfaces/IVaultPriceFeed.sol';
import '../core/interfaces/IRouter.sol';
import '../referrals/interfaces/IReferralStorage.sol';
import '../tokens/interfaces/IYieldToken.sol';
import '../tokens/interfaces/IBaseToken.sol';
import '../tokens/interfaces/IMintable.sol';
import '../tokens/interfaces/IMUSD.sol';

contract TimeLock is ITimeLock {
    using SafeMath for uint256;

    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MAX_BUFFER = 5 days;
    uint256 public constant MAX_FUNDING_RATE_FACTOR = 200; // 0.02%
    uint256 public constant MAX_LEVERAGE_VALIDATION = 500000; // 50x

    uint256 public buffer;
    address public admin;

    address public tokenManager;
    address public rewardManager;
    address public mintReceiver;
    uint256 public maxTokenSupply;

    uint256 public marginFeeBasisPoints;
    uint256 public maxMarginFeeBasisPoints;
    bool public shouldToggleIsLeverageEnabled;

    mapping(bytes32 => uint256) public pendingActions;
    mapping(address => bool) public excludedTokens;

    mapping(address => bool) public isHandler;

    event SignalPendingAction(bytes32 action);
    event SignalApprove(address token, address spender, uint256 amount, bytes32 action);
    event SignalWithdrawToken(address target, address token, address receiver, uint256 amount, bytes32 action);
    event SignalMint(address token, address receiver, uint256 amount, bytes32 action);
    event SignalTransferGovernance(address target, address governor, bytes32 action);
    event SignalSetHandler(address target, address handler, bool isActive, bytes32 action);
    event SignalSetPriceFeed(address vault, address priceFeed, bytes32 action);
    event SignalAddPlugin(address router, address plugin, bytes32 action);
    event SignalSetPriceFeedWatcher(address fastPriceFeed, address account, bool isActive);
    event SignalRedeemMusd(address vault, address token, uint256 amount);
    event SignalVaultSetTokenConfig(
        address vault,
        address token,
        uint256 tokenDecimals,
        uint256 tokenWeight,
        uint256 minProfitBps,
        uint256 maxMusdAmount,
        bool isStable,
        bool isShortable
    );
    event SignalPriceFeedSetTokenConfig(address vaultPriceFeed, address token, address priceFeed, uint256 priceDecimals, bool isStrictStable);
    event SignalPriceFeedAddTokenIndex(address vaultPriceFeed, uint256 tokenIndex);
    event SignalPriceFeedRemoveTokenIndex(address vaultPriceFeed, uint256 tokenIndex);

    event ClearAction(bytes32 action);

    modifier onlyAdmin() {
        require(msg.sender == admin, 'TimeLock: forbidden');
        _;
    }

    modifier onlyAdminOrHandler() {
        require(msg.sender == admin || isHandler[msg.sender], 'TimeLock: forbidden');
        _;
    }

    modifier onlyTokenManager() {
        require(msg.sender == tokenManager, 'TimeLock: forbidden');
        _;
    }

    modifier onlyRewardManager() {
        require(msg.sender == rewardManager, 'TimeLock: forbidden');
        _;
    }

    constructor(
        address _admin,
        uint256 _buffer,
        address _rewardManager,
        address _tokenManager,
        address _mintReceiver,
        uint256 _maxTokenSupply,
        uint256 _marginFeeBasisPoints,
        uint256 _maxMarginFeeBasisPoints
    ) {
        require(_buffer <= MAX_BUFFER, 'TimeLock: invalid _buffer');
        admin = _admin;
        buffer = _buffer;
        rewardManager = _rewardManager;
        tokenManager = _tokenManager;
        mintReceiver = _mintReceiver;
        maxTokenSupply = _maxTokenSupply;

        marginFeeBasisPoints = _marginFeeBasisPoints;
        maxMarginFeeBasisPoints = _maxMarginFeeBasisPoints;
    }

    function setAdmin(address _admin) external override onlyTokenManager {
        admin = _admin;
    }

    function setExternalAdmin(address _target, address _admin) external onlyAdmin {
        require(_target != address(this), 'TimeLock: invalid _target');
        IAdmin(_target).setAdmin(_admin);
    }

    function setContractHandler(address _handler, bool _isActive) external onlyAdmin {
        isHandler[_handler] = _isActive;
    }

    function setBuffer(uint256 _buffer) external onlyAdmin {
        require(_buffer <= MAX_BUFFER, 'TimeLock: invalid _buffer');
        require(_buffer > buffer, 'TimeLock: buffer cannot be decreased');
        buffer = _buffer;
    }

    function mint(address _token, uint256 _amount) external onlyAdmin {
        _mint(_token, mintReceiver, _amount);
    }

    function setMaxLeverage(address _vault, uint256 _maxLeverage) external onlyAdmin {
        require(_maxLeverage > MAX_LEVERAGE_VALIDATION, 'TimeLock: invalid _maxLeverage');
        IVault(_vault).setMaxLeverage(_maxLeverage);
    }

    function setFundingRate(
        address _vault,
        uint256 _fundingInterval,
        uint256 _fundingRateFactor,
        uint256 _stableFundingRateFactor
    ) external onlyAdminOrHandler {
        require(_fundingRateFactor < MAX_FUNDING_RATE_FACTOR, 'TimeLock: invalid _fundingRateFactor');
        require(_stableFundingRateFactor < MAX_FUNDING_RATE_FACTOR, 'TimeLock: invalid _stableFundingRateFactor');
        IVault(_vault).setFundingRate(_fundingInterval, _fundingRateFactor, _stableFundingRateFactor);
    }

    function setShouldToggleIsLeverageEnabled(bool _shouldToggleIsLeverageEnabled) external onlyAdminOrHandler {
        shouldToggleIsLeverageEnabled = _shouldToggleIsLeverageEnabled;
    }

    function setMarginFeeBasisPoints(uint256 _marginFeeBasisPoints, uint256 _maxMarginFeeBasisPoints) external onlyAdminOrHandler {
        marginFeeBasisPoints = _marginFeeBasisPoints;
        maxMarginFeeBasisPoints = _maxMarginFeeBasisPoints;
    }

    function setSwapFees(
        address _vault,
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints
    ) external onlyAdminOrHandler {
        IVault vault = IVault(_vault);

        vault.setFees(
            _taxBasisPoints,
            _stableTaxBasisPoints,
            _mintBurnFeeBasisPoints,
            _swapFeeBasisPoints,
            _stableSwapFeeBasisPoints,
            maxMarginFeeBasisPoints,
            vault.liquidationFeeUsd(),
            vault.minProfitTime(),
            vault.hasDynamicFees()
        );
    }

    // assign _marginFeeBasisPoints to this.marginFeeBasisPoints
    // because enableLeverage would update Vault.marginFeeBasisPoints to this.marginFeeBasisPoints
    // and disableLeverage would reset the Vault.marginFeeBasisPoints to this.maxMarginFeeBasisPoints
    function setFees(
        address _vault,
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        uint256 _minProfitTime,
        bool _hasDynamicFees
    ) external onlyAdminOrHandler {
        marginFeeBasisPoints = _marginFeeBasisPoints;

        IVault(_vault).setFees(
            _taxBasisPoints,
            _stableTaxBasisPoints,
            _mintBurnFeeBasisPoints,
            _swapFeeBasisPoints,
            _stableSwapFeeBasisPoints,
            maxMarginFeeBasisPoints,
            _liquidationFeeUsd,
            _minProfitTime,
            _hasDynamicFees
        );
    }

    function enableLeverage(address _vault) external override onlyAdminOrHandler {
        IVault vault = IVault(_vault);

        if (shouldToggleIsLeverageEnabled) {
            vault.setIsLeverageEnabled(true);
        }

        vault.setFees(
            vault.taxBasisPoints(),
            vault.stableTaxBasisPoints(),
            vault.mintBurnFeeBasisPoints(),
            vault.swapFeeBasisPoints(),
            vault.stableSwapFeeBasisPoints(),
            marginFeeBasisPoints,
            vault.liquidationFeeUsd(),
            vault.minProfitTime(),
            vault.hasDynamicFees()
        );
    }

    function disableLeverage(address _vault) external override onlyAdminOrHandler {
        IVault vault = IVault(_vault);

        if (shouldToggleIsLeverageEnabled) {
            vault.setIsLeverageEnabled(false);
        }

        vault.setFees(
            vault.taxBasisPoints(),
            vault.stableTaxBasisPoints(),
            vault.mintBurnFeeBasisPoints(),
            vault.swapFeeBasisPoints(),
            vault.stableSwapFeeBasisPoints(),
            maxMarginFeeBasisPoints, // marginFeeBasisPoints
            vault.liquidationFeeUsd(),
            vault.minProfitTime(),
            vault.hasDynamicFees()
        );
    }

    function setIsLeverageEnabled(address _vault, bool _isLeverageEnabled) external override onlyAdminOrHandler {
        IVault(_vault).setIsLeverageEnabled(_isLeverageEnabled);
    }

    function setTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxMusdAmount,
        uint256 _bufferAmount,
        uint256 _musdAmount
    ) external onlyAdminOrHandler {
        require(_minProfitBps <= 500, 'TimeLock: invalid _minProfitBps');

        IVault vault = IVault(_vault);
        require(vault.whitelistedTokens(_token), 'TimeLock: token not yet whitelisted');

        uint256 tokenDecimals = vault.tokenDecimals(_token);
        bool isStable = vault.stableTokens(_token);
        bool isShortable = vault.shortableTokens(_token);

        IVault(_vault).setTokenConfig(_token, tokenDecimals, _tokenWeight, _minProfitBps, _maxMusdAmount, isStable, isShortable);

        IVault(_vault).setBufferAmount(_token, _bufferAmount);

        IVault(_vault).setMusdAmount(_token, _musdAmount);
    }

    function setMaxGlobalShortSize(address _vault, address _token, uint256 _amount) external onlyAdmin {
        IVault(_vault).setMaxGlobalShortSize(_token, _amount);
    }

    function removeAdmin(address _token, address _account) external onlyAdmin {
        IYieldToken(_token).removeAdmin(_account);
    }

    function setMaxStrictPriceDeviation(address _priceFeed, uint256 _maxStrictPriceDeviation) external onlyAdminOrHandler {
        IVaultPriceFeed(_priceFeed).setMaxStrictPriceDeviation(_maxStrictPriceDeviation);
    }

    function setSpreadBasisPoints(address _priceFeed, address _token, uint256 _spreadBasisPoints) external onlyAdminOrHandler {
        IVaultPriceFeed(_priceFeed).setSpreadBasisPoints(_token, _spreadBasisPoints);
    }

    function setPriceSampleSpaceTime(address _priceFeed, uint256 _priceSampleSpaceTime) external onlyAdminOrHandler {
        require(_priceSampleSpaceTime > 0, 'Invalid _priceSampleSpace');
        IVaultPriceFeed(_priceFeed).setPriceSampleSpaceTime(_priceSampleSpaceTime);
    }

    function setIsSwapEnabled(address _vault, bool _isSwapEnabled) external onlyAdminOrHandler {
        IVault(_vault).setIsSwapEnabled(_isSwapEnabled);
    }

    function setTier(address _referralStorage, uint256 _tierId, uint256 _totalRebate, uint256 _discountShare) external onlyAdminOrHandler {
        IReferralStorage(_referralStorage).setTier(_tierId, _totalRebate, _discountShare);
    }

    function setReferrerTier(address _referralStorage, address _referrer, uint256 _tierId) external onlyAdminOrHandler {
        IReferralStorage(_referralStorage).setReferrerTier(_referrer, _tierId);
    }

    function govSetCodeOwner(address _referralStorage, bytes32 _code, address _newAccount) external onlyAdminOrHandler {
        IReferralStorage(_referralStorage).govSetCodeOwner(_code, _newAccount);
    }

    function setMaxGasPrice(address _vault, uint256 _maxGasPrice) external onlyAdmin {
        require(_maxGasPrice > 5000000000, 'Invalid _maxGasPrice');
        IVault(_vault).setMaxGasPrice(_maxGasPrice);
    }

    function withdrawFees(address _vault, address _token, address _receiver) external onlyAdmin {
        IVault(_vault).withdrawFees(_token, _receiver);
    }

    function batchWithdrawFees(address _vault, address[] memory _tokens, address _receiver) external onlyAdmin {
        for (uint256 i = 0; i < _tokens.length; i++) {
            IVault(_vault).withdrawFees(_tokens[i], _receiver);
        }
    }

    function setInPrivateLiquidationMode(address _vault, bool _inPrivateLiquidationMode) external onlyAdmin {
        IVault(_vault).setInPrivateLiquidationMode(_inPrivateLiquidationMode);
    }

    function setLiquidator(address _vault, address _liquidator, bool _isActive) external onlyAdmin {
        IVault(_vault).setLiquidator(_liquidator, _isActive);
    }

    function addExcludedToken(address _token) external onlyAdmin {
        excludedTokens[_token] = true;
    }

    function setInPrivateTransferMode(address _token, bool _inPrivateTransferMode) external onlyAdmin {
        if (excludedTokens[_token]) {
            // excludedTokens can only have their transfers enabled
            require(_inPrivateTransferMode == false, 'TimeLock: invalid _inPrivateTransferMode');
        }

        IBaseToken(_token).setInPrivateTransferMode(_inPrivateTransferMode);
    }

    function managedSetHandler(address _target, address _handler, bool _isActive) external override onlyRewardManager {
        IHandlerTarget(_target).setHandler(_handler, _isActive);
    }

    function managedSetMinter(address _target, address _minter, bool _isActive) external override onlyRewardManager {
        IMintable(_target).setMinter(_minter, _isActive);
    }

    function transferIn(address _sender, address _token, uint256 _amount) external onlyAdmin {
        IERC20(_token).transferFrom(_sender, address(this), _amount);
    }

    function signalApprove(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('approve', _token, _spender, _amount));
        _setPendingAction(action);
        emit SignalApprove(_token, _spender, _amount, action);
    }

    function approve(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('approve', _token, _spender, _amount));
        _validateAction(action);
        _clearAction(action);
        IERC20(_token).approve(_spender, _amount);
    }

    function signalWithdrawToken(address _target, address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('withdrawToken', _target, _token, _receiver, _amount));
        _setPendingAction(action);
        emit SignalWithdrawToken(_target, _token, _receiver, _amount, action);
    }

    function withdrawToken(address _target, address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('withdrawToken', _target, _token, _receiver, _amount));
        _validateAction(action);
        _clearAction(action);
        IBaseToken(_target).withdrawToken(_token, _receiver, _amount);
    }

    function signalMint(address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('mint', _token, _receiver, _amount));
        _setPendingAction(action);
        emit SignalMint(_token, _receiver, _amount, action);
    }

    function processMint(address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('mint', _token, _receiver, _amount));
        _validateAction(action);
        _clearAction(action);

        _mint(_token, _receiver, _amount);
    }

    function signalTransferGovernance(address _target, address _governor) external override onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('transferGovernance', _target, _governor));
        _setPendingAction(action);
        emit SignalTransferGovernance(_target, _governor, action);
    }

    function transferGovernance(address _target, address _governor) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('transferGovernance', _target, _governor));
        _validateAction(action);
        _clearAction(action);
        ITimeLockTarget(_target).transferGovernance(_governor);
    }

    function acceptGovernance(address _target) external onlyAdmin {
        ITimeLockTarget(_target).acceptGovernance();
    }

    function signalSetHandler(address _target, address _handler, bool _isActive) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('setHandler', _target, _handler, _isActive));
        _setPendingAction(action);
        emit SignalSetHandler(_target, _handler, _isActive, action);
    }

    function setHandler(address _target, address _handler, bool _isActive) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('setHandler', _target, _handler, _isActive));
        _validateAction(action);
        _clearAction(action);
        IHandlerTarget(_target).setHandler(_handler, _isActive);
    }

    function signalSetPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('setPriceFeed', _vault, _priceFeed));
        _setPendingAction(action);
        emit SignalSetPriceFeed(_vault, _priceFeed, action);
    }

    function setPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('setPriceFeed', _vault, _priceFeed));
        _validateAction(action);
        _clearAction(action);
        IVault(_vault).setPriceFeed(_priceFeed);
    }

    function signalAddPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('addPlugin', _router, _plugin));
        _setPendingAction(action);
        emit SignalAddPlugin(_router, _plugin, action);
    }

    function addPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('addPlugin', _router, _plugin));
        _validateAction(action);
        _clearAction(action);
        IRouter(_router).addPlugin(_plugin);
    }

    function signalRedeemMusd(address _vault, address _token, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('redeemMusd', _vault, _token, _amount));
        _setPendingAction(action);
        emit SignalRedeemMusd(_vault, _token, _amount);
    }

    function redeemMusd(address _vault, address _token, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('redeemMusd', _vault, _token, _amount));
        _validateAction(action);
        _clearAction(action);

        address musd = IVault(_vault).musd();
        IVault(_vault).setManager(address(this), true);
        IMUSD(musd).addVault(address(this));

        IMUSD(musd).mint(address(this), _amount);
        IERC20(musd).transfer(address(_vault), _amount);

        IVault(_vault).sellMUSD(_token, mintReceiver);

        IVault(_vault).setManager(address(this), false);
        IMUSD(musd).removeVault(address(this));
    }

    function signalVaultSetTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenDecimals,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxMusdAmount,
        bool _isStable,
        bool _isShortable
    ) external onlyAdmin {
        bytes32 action = keccak256(
            abi.encodePacked('vaultSetTokenConfig', _vault, _token, _tokenDecimals, _tokenWeight, _minProfitBps, _maxMusdAmount, _isStable, _isShortable)
        );

        _setPendingAction(action);

        emit SignalVaultSetTokenConfig(_vault, _token, _tokenDecimals, _tokenWeight, _minProfitBps, _maxMusdAmount, _isStable, _isShortable);
    }

    function vaultSetTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenDecimals,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxMusdAmount,
        bool _isStable,
        bool _isShortable
    ) external onlyAdmin {
        bytes32 action = keccak256(
            abi.encodePacked('vaultSetTokenConfig', _vault, _token, _tokenDecimals, _tokenWeight, _minProfitBps, _maxMusdAmount, _isStable, _isShortable)
        );

        _validateAction(action);
        _clearAction(action);

        IVault(_vault).setTokenConfig(_token, _tokenDecimals, _tokenWeight, _minProfitBps, _maxMusdAmount, _isStable, _isShortable);
    }

    function signalPriceFeedSetTokenConfig(
        address _vaultPriceFeed,
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        bool _isStrictStable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('priceFeedSetTokenConfig', _vaultPriceFeed, _token, _priceFeed, _priceDecimals, _isStrictStable));

        _setPendingAction(action);

        emit SignalPriceFeedSetTokenConfig(_vaultPriceFeed, _token, _priceFeed, _priceDecimals, _isStrictStable);
    }

    function priceFeedSetTokenConfig(
        address _vaultPriceFeed,
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        bool _isStrictStable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('priceFeedSetTokenConfig', _vaultPriceFeed, _token, _priceFeed, _priceDecimals, _isStrictStable));

        _validateAction(action);
        _clearAction(action);

        IVaultPriceFeed(_vaultPriceFeed).setTokenConfig(_token, _priceFeed, _priceDecimals, _isStrictStable);
    }

    function cancelAction(bytes32 _action) external onlyAdmin {
        _clearAction(_action);
    }

    function _mint(address _token, address _receiver, uint256 _amount) private {
        IMintable mintable = IMintable(_token);

        if (!mintable.isMinter(address(this))) {
            mintable.setMinter(address(this), true);
        }

        mintable.mint(_receiver, _amount);
        require(IERC20(_token).totalSupply() <= maxTokenSupply, 'TimeLock: maxTokenSupply exceeded');
    }

    function _setPendingAction(bytes32 _action) private {
        pendingActions[_action] = block.timestamp.add(buffer);
        emit SignalPendingAction(_action);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action] != 0, 'TimeLock: action not signalled');
        require(pendingActions[_action] < block.timestamp, 'TimeLock: action time not yet passed');
    }

    function _clearAction(bytes32 _action) private {
        require(pendingActions[_action] != 0, 'TimeLock: invalid _action');
        delete pendingActions[_action];
        emit ClearAction(_action);
    }
}