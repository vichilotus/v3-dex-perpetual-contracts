//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/**
 * @notice Anti-Bot Helper
 * Blacklis feature
 * Max TX Amount feature
 * Max Wallet Amount feature
 */
contract AntiBotHelper is Ownable {
    using SafeMath for uint256;

    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address private constant ZERO = address(0);

    uint256 public constant MAX_TX_AMOUNT_MIN_LIMIT = 100 ether;
    uint256 public constant MAX_WALLET_AMOUNT_MIN_LIMIT = 1000 ether;

    mapping(address => bool) internal _isExcludedFromMaxTx;
    mapping(address => bool) internal _isExcludedFromMaxWallet;
    mapping(address => bool) internal _blacklist;

    uint256 public _maxTxAmount = 100000 ether;
    uint256 public _maxWalletAmount = 10000000 ether;

    event ExcludedFromBlacklist(address indexed account);
    event IncludedInBlacklist(address indexed account);
    event ExcludedFromMaxTx(address indexed account);
    event IncludedInMaxTx(address indexed account);
    event ExcludedFromMaxWallet(address indexed account);
    event IncludedInMaxWallet(address indexed account);

    constructor() {
        _isExcludedFromMaxTx[_msgSender()] = true;
        _isExcludedFromMaxTx[DEAD] = true;
        _isExcludedFromMaxTx[ZERO] = true;
        _isExcludedFromMaxTx[address(this)] = true;

        _isExcludedFromMaxWallet[_msgSender()] = true;
        _isExcludedFromMaxWallet[DEAD] = true;
        _isExcludedFromMaxWallet[ZERO] = true;
        _isExcludedFromMaxWallet[address(this)] = true;
    }

    /**
     * @notice Exclude the account from black list
     * @param account: the account to be excluded
     * @dev Only callable by owner
     */
    function excludeFromBlacklist(address account) external onlyOwner {
        _blacklist[account] = false;
        emit ExcludedFromBlacklist(account);
    }

    /**
     * @notice Include the account in black list
     * @param account: the account to be included
     * @dev Only callable by owner
     */
    function includeInBlacklist(address account) external onlyOwner {
        _blacklist[account] = true;
        emit IncludedInBlacklist(account);
    }

    /**
     * @notice Check if the account is included in black list
     * @param account: the account to be checked
     */
    function isIncludedInBlacklist(
        address account
    ) external view returns (bool) {
        return _blacklist[account];
    }

    /**
     * @notice Exclude the account from max tx limit
     * @param account: the account to be excluded
     * @dev Only callable by owner
     */
    function excludeFromMaxTx(address account) external onlyOwner {
        _isExcludedFromMaxTx[account] = true;
        emit ExcludedFromMaxTx(account);
    }

    /**
     * @notice Include the account in max tx limit
     * @param account: the account to be included
     * @dev Only callable by owner
     */
    function includeInMaxTx(address account) external onlyOwner {
        _isExcludedFromMaxTx[account] = false;
        emit IncludedInMaxTx(account);
    }

    /**
     * @notice Check if the account is excluded from max tx limit
     * @param account: the account to be checked
     */
    function isExcludedFromMaxTx(address account) external view returns (bool) {
        return _isExcludedFromMaxTx[account];
    }

    /**
     * @notice Exclude the account from max wallet limit
     * @param account: the account to be excluded
     * @dev Only callable by owner
     */
    function excludeFromMaxWallet(address account) external onlyOwner {
        _isExcludedFromMaxWallet[account] = true;
        emit ExcludedFromMaxWallet(account);
    }

    /**
     * @notice Include the account in max wallet limit
     * @param account: the account to be included
     * @dev Only callable by owner
     */
    function includeInMaxWallet(address account) external onlyOwner {
        _isExcludedFromMaxWallet[account] = false;
        emit IncludedInMaxWallet(account);
    }

    /**
     * @notice Check if the account is excluded from max wallet limit
     * @param account: the account to be checked
     */
    function isExcludedFromMaxWallet(
        address account
    ) external view returns (bool) {
        return _isExcludedFromMaxWallet[account];
    }

    /**
     * @notice Set anti whales limit configuration
     * @param maxTxAmount: max amount of token in a transaction
     * @param maxWalletAmount: max amount of token can be kept in a wallet
     * @dev Only callable by owner
     */
    function setAntiWhalesConfiguration(
        uint256 maxTxAmount,
        uint256 maxWalletAmount
    ) external onlyOwner {
        require(
            maxTxAmount >= MAX_TX_AMOUNT_MIN_LIMIT,
            "Max tx amount too small"
        );
        require(
            maxWalletAmount >= MAX_WALLET_AMOUNT_MIN_LIMIT,
            "Max wallet amount too small"
        );
        _maxTxAmount = maxTxAmount;
        _maxWalletAmount = maxWalletAmount;
    }

    function checkBot(address from, address to, uint256 amount) internal view {
        require(amount > 0, "Transfer amount must be greater than zero");

        require(
            !_blacklist[from] && !_blacklist[to],
            "Transfer from or to the blacklisted account"
        );

        // Check max tx limit
        if (!_isExcludedFromMaxTx[from] && !_isExcludedFromMaxTx[to]) {
            require(
                amount <= _maxTxAmount,
                "Too many tokens are going to be transferred"
            );
        }

        // Check max wallet amount limit
        if (!_isExcludedFromMaxWallet[to]) {
            require(
                IERC20(address(this)).balanceOf(to).add(amount) <=
                    _maxWalletAmount,
                "Too many tokens are going to be stored in target account"
            );
        }
    }
}
