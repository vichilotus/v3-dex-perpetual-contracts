//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @notice Tax Helper
 * Auto liquidity fee
 * Marketing fee
 * Burn fee
 * Fee in buy/sell/transfer separately
 */
contract FeeHelper is Ownable {
    using SafeMath for uint256;

    enum TX_CASE {
        TRANSFER,
        BUY,
        SELL
    }

    struct TokenFee {
        uint16 liquifyFee;
        uint16 marketingFee;
        uint16 burnFee;
    }

    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address private constant ZERO = address(0);

    uint16 public constant MAX_LIQUIFY_FEE = 500; // 5% max
    uint16 public constant MAX_MARKETING_FEE = 500; // 5% max
    uint16 public constant MAX_BURN_FEE = 500; // 5% max

    mapping(TX_CASE => TokenFee) public _tokenFees;
    mapping(address => bool) internal _isExcludedFromFee;
    mapping(address => bool) internal _isUniswapV2Pair;

    event AccountExcludedFromFee(address indexed account);
    event AccountIncludedInFee(address indexed account);

    constructor() {
        _isExcludedFromFee[_msgSender()] = true;
        _isExcludedFromFee[DEAD] = true;
        _isExcludedFromFee[ZERO] = true;
        _isExcludedFromFee[address(this)] = true;

        _tokenFees[TX_CASE.TRANSFER].liquifyFee = 0;
        _tokenFees[TX_CASE.TRANSFER].marketingFee = 0;
        _tokenFees[TX_CASE.TRANSFER].burnFee = 0;

        _tokenFees[TX_CASE.BUY].liquifyFee = 200;
        _tokenFees[TX_CASE.BUY].marketingFee = 200;
        _tokenFees[TX_CASE.BUY].burnFee = 100;

        _tokenFees[TX_CASE.SELL].liquifyFee = 200;
        _tokenFees[TX_CASE.SELL].marketingFee = 200;
        _tokenFees[TX_CASE.SELL].burnFee = 100;
    }

    /**
     * @notice Update fee in the token
     * @param feeCase: which case the fee is for: transfer / buy / sell
     * @param liquifyFee: fee percent for liquifying
     * @param marketingFee: fee percent for marketing
     * @param burnFee: fee percent for burning
     */
    function setFee(
        TX_CASE feeCase,
        uint16 liquifyFee,
        uint16 marketingFee,
        uint16 burnFee
    ) external onlyOwner {
        require(liquifyFee <= MAX_LIQUIFY_FEE, "Liquidity fee overflow");
        require(marketingFee <= MAX_MARKETING_FEE, "Buyback fee overflow");
        require(burnFee <= MAX_BURN_FEE, "Burn fee overflow");
        _tokenFees[feeCase].liquifyFee = liquifyFee;
        _tokenFees[feeCase].marketingFee = marketingFee;
        _tokenFees[feeCase].burnFee = burnFee;
    }

    /**
     * @notice Exclude the account from fee
     * @param account: the account to be excluded
     * @dev Only callable by owner
     */
    function excludeAccountFromFee(address account) external onlyOwner {
        _isExcludedFromFee[account] = true;
        emit AccountExcludedFromFee(account);
    }

    /**
     * @notice Include account in fee
     * @dev Only callable by owner
     */
    function includeAccountInFee(address account) external onlyOwner {
        _isExcludedFromFee[account] = false;
        emit AccountIncludedInFee(account);
    }

    /**
     * @notice Check if the account is excluded from the fees
     * @param account: the account to be checked
     */
    function isAccountExcludedFromFee(
        address account
    ) external view returns (bool) {
        return _isExcludedFromFee[account];
    }

    /**
     * @notice Check if fee should be applied
     */
    function shouldFeeApplied(
        address from,
        address to
    ) internal view returns (bool feeApplied, TX_CASE txCase) {
        // Sender or receiver is excluded from fee
        if (_isExcludedFromFee[from] || _isExcludedFromFee[to]) {
            feeApplied = false;
            txCase = TX_CASE.TRANSFER; // second param is default one becuase it would not be used in this case
        }
        // Buying tokens
        else if (_isUniswapV2Pair[from]) {
            TokenFee storage buyFee = _tokenFees[TX_CASE.BUY];
            feeApplied =
                (buyFee.liquifyFee + buyFee.marketingFee + buyFee.burnFee) > 0;
            txCase = TX_CASE.BUY;
        }
        // Selling tokens
        else if (_isUniswapV2Pair[to]) {
            TokenFee storage sellFee = _tokenFees[TX_CASE.SELL];
            feeApplied =
                (sellFee.liquifyFee + sellFee.marketingFee + sellFee.burnFee) >
                0;
            txCase = TX_CASE.SELL;
        }
        // Transferring tokens
        else {
            TokenFee storage transferFee = _tokenFees[TX_CASE.TRANSFER];
            feeApplied =
                (transferFee.liquifyFee +
                    transferFee.marketingFee +
                    transferFee.burnFee) >
                0;
            txCase = TX_CASE.TRANSFER;
        }
    }

    /**
     * @notice Exclude lp address from UniswapV2Pair
     */
    function excludeFromUniswapV2Pair(address lpAddress) external onlyOwner {
        _isUniswapV2Pair[lpAddress] = false;
    }

    /**
     * @notice Include lp address in UniswapV2Pair
     */
    function includeInUniswapV2Pair(address lpAddress) external onlyOwner {
        _isUniswapV2Pair[lpAddress] = true;
    }

    /**
     * @notice Check if the lp address is UniswapV2Pair
     */
    function isUniswapV2Pair(address lpAddress) external view returns (bool) {
        return _isUniswapV2Pair[lpAddress];
    }
}
