// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

interface IVault {
    function isInitialized() external view returns (bool);

    function isSwapEnabled() external view returns (bool);

    function isLeverageEnabled() external view returns (bool);

    function setError(uint256 _errorCode, string calldata _error) external;

    function router() external view returns (address);

    function musd() external view returns (address);

    function governor() external view returns (address);

    function vaultPositionController() external view returns (address);

    function whitelistedTokenCount() external view returns (uint256);

    function maxLeverage() external view returns (uint256);

    function minProfitTime() external view returns (uint256);

    function hasDynamicFees() external view returns (bool);

    function fundingInterval() external view returns (uint256);

    function totalTokenWeights() external view returns (uint256);

    function getTargetMusdAmount(address _token) external view returns (uint256);

    function inManagerMode() external view returns (bool);

    function inPrivateLiquidationMode() external view returns (bool);

    function maxGasPrice() external view returns (uint256);

    function approvedRouters(address _account, address _router) external view returns (bool);

    function isLiquidator(address _account) external view returns (bool);

    function isManager(address _account) external view returns (bool);

    function minProfitBasisPoints(address _token) external view returns (uint256);

    function tokenBalances(address _token) external view returns (uint256);

    function lastFundingTimes(address _token) external view returns (uint256);

    function setMaxLeverage(uint256 _maxLeverage) external;

    function setInManagerMode(bool _inManagerMode) external;

    function setManager(address _manager, bool _isManager) external;

    function setIsSwapEnabled(bool _isSwapEnabled) external;

    function setIsLeverageEnabled(bool _isLeverageEnabled) external;

    function setMaxGasPrice(uint256 _maxGasPrice) external;

    function setMusdAmount(address _token, uint256 _amount) external;

    function setBufferAmount(address _token, uint256 _amount) external;

    function setMaxGlobalShortSize(address _token, uint256 _amount) external;

    function setInPrivateLiquidationMode(bool _inPrivateLiquidationMode) external;

    function setLiquidator(address _liquidator, bool _isActive) external;

    function setFundingRate(uint256 _fundingInterval, uint256 _fundingRateFactor, uint256 _stableFundingRateFactor) external;

    function setFees(
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        uint256 _minProfitTime,
        bool _hasDynamicFees
    ) external;

    function setTokenConfig(
        address _token,
        uint256 _tokenDecimals,
        uint256 _redemptionBps,
        uint256 _minProfitBps,
        uint256 _maxMusdAmount,
        bool _isStable,
        bool _isShortable
    ) external;

    function setPriceFeed(address _priceFeed) external;

    function withdrawFees(address _token, address _receiver) external returns (uint256);

    function directPoolDeposit(address _token) external;

    function buyMUSD(address _token, address _receiver) external returns (uint256);

    function sellMUSD(address _token, address _receiver) external returns (uint256);

    function swap(address _tokenIn, address _tokenOut, address _receiver) external returns (uint256);

    function tokenToUsdMin(address _token, uint256 _tokenAmount) external view returns (uint256);

    function usdToTokenMax(address _token, uint256 _usdAmount) external view returns (uint256);

    function usdToTokenMin(address _token, uint256 _usdAmount) external view returns (uint256);

    function usdToToken(address _token, uint256 _usdAmount, uint256 _price) external view returns (uint256);

    function priceFeed() external view returns (address);

    function fundingRateFactor() external view returns (uint256);

    function stableFundingRateFactor() external view returns (uint256);

    function cumulativeFundingRates(address _token) external view returns (uint256);

    function getNextFundingRate(address _token) external view returns (uint256);

    function getEntryFundingRate(address _collateralToken, address _indexToken, bool _isLong) external view returns (uint256);

    function getFundingFee(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        uint256 _size,
        uint256 _entryFundingRate
    ) external view returns (uint256);

    function getPositionFee(address _account, address _collateralToken, address _indexToken, bool _isLong, uint256 _sizeDelta) external view returns (uint256);

    function getSwapFeeBasisPoints(address _tokenIn, address _tokenOut, uint256 _musdAmount) external view returns (uint256);

    function getFeeBasisPoints(
        address _token,
        uint256 _musdDelta,
        uint256 _feeBasisPoints,
        uint256 _taxBasisPoints,
        bool _increment
    ) external view returns (uint256);

    function liquidationFeeUsd() external view returns (uint256);

    function taxBasisPoints() external view returns (uint256);

    function stableTaxBasisPoints() external view returns (uint256);

    function mintBurnFeeBasisPoints() external view returns (uint256);

    function swapFeeBasisPoints() external view returns (uint256);

    function stableSwapFeeBasisPoints() external view returns (uint256);

    function marginFeeBasisPoints() external view returns (uint256);

    function allWhitelistedTokensLength() external view returns (uint256);

    function allWhitelistedTokens(uint256) external view returns (address);

    function whitelistedTokens(address _token) external view returns (bool);

    function stableTokens(address _token) external view returns (bool);

    function shortableTokens(address _token) external view returns (bool);

    function feeReserves(address _token) external view returns (uint256);

    function globalShortSizes(address _token) external view returns (uint256);

    function globalShortAveragePrices(address _token) external view returns (uint256);

    function maxGlobalShortSizes(address _token) external view returns (uint256);

    function errors(uint256 _errorCode) external view returns (string calldata);

    function tokenDecimals(address _token) external view returns (uint256);

    function tokenWeights(address _token) external view returns (uint256);

    function guaranteedUsd(address _token) external view returns (uint256);

    function poolAmounts(address _token) external view returns (uint256);

    function bufferAmounts(address _token) external view returns (uint256);

    function reservedAmounts(address _token) external view returns (uint256);

    function musdAmounts(address _token) external view returns (uint256);

    function maxMusdAmounts(address _token) external view returns (uint256);

    function getRedemptionAmount(address _token, uint256 _musdAmount, bool _validatePrice) external view returns (uint256);

    function getMaxPrice(address _token, bool _validate) external view returns (uint256);

    function getMinPrice(address _token, bool _validate) external view returns (uint256);

    function adjustForDecimals(uint256 _amount, address _tokenDiv, address _tokenMul) external view returns (uint256);

    function updateCumulativeFundingRate(address _collateralToken, address _indexToken) external;

    function collectSwapFees(address _token, uint256 _amount, uint256 _feeBasisPoints) external returns (uint256);

    function collectMarginFees(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        uint256 _sizeDelta,
        uint256 _size,
        uint256 _entryFundingRate
    ) external returns (uint256);

    function collectLiquidateMarginFees(address _collateralToken, uint256 _marginFees) external;

    function transferIn(address _token) external returns (uint256);

    function transferOut(address _token, uint256 _amount, address _receiver) external;

    function increasePoolAmount(address _token, uint256 _amount) external;

    function decreasePoolAmount(address _token, uint256 _amount) external;

    function increaseMusdAmount(address _token, uint256 _amount) external;

    function decreaseMusdAmount(address _token, uint256 _amount) external;

    function increaseReservedAmount(address _token, uint256 _amount) external;

    function decreaseReservedAmount(address _token, uint256 _amount) external;

    function increaseGuaranteedUsd(address _token, uint256 _usdAmount) external;

    function decreaseGuaranteedUsd(address _token, uint256 _usdAmount) external;

    function increaseGlobalShortSize(address _token, uint256 _amount) external;

    function decreaseGlobalShortSize(address _token, uint256 _amount) external;

    function setIncludeAmmPrice(bool _includeAmmPrice) external;

    function setGlobalShortAveragePrices(address _indexToken, uint256 _price) external;
}
