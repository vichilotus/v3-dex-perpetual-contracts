// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

abstract contract Governable {
    address private _governor;
    mapping(address => bool) private _governorsTable;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error GovernableUnauthorizedAccount(address account);

    /**
     * @dev The governor is not a valid governor account. (eg. `address(0)`)
     */
    error GovernableInvalidGovernor(address governor);

    event GovernanceTransferStarted(address indexed previousGovernor, address indexed newGovernor);

    event GovernanceTransferred(address indexed previousGovernor, address indexed newGovernor);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial governor.
     */
    constructor(address initialGovernor) {
        if (initialGovernor == address(0)) {
            revert GovernableInvalidGovernor(address(0));
        } else _governorsTable[initialGovernor] = true;
        _acceptGovernance(initialGovernor);
    }

    /**
     * @dev Throws if called by any account other than the governor.
     */
    modifier onlyGovernor() {
        _checkGovernor();
        _;
    }

    /**
     * @dev Returns the address of the current governor.
     */
    function governor() public view virtual returns (address) {
        return _governor;
    }

    /**
     * @dev Returns the address of the governor if exist on governance.
     * or return address zero if account can not validated
     */
    function governanceTable(address account) public view virtual returns (address) {
        if (_governorsTable[account]) return account;
        else return address(0);
    }

    /**
     * @dev Throws if the sender is not the governor.
     */
    function _checkGovernor() internal view virtual {
        if (_governor != msg.sender || !_governorsTable[msg.sender]) {
            revert GovernableUnauthorizedAccount(msg.sender);
        }
    }

    /**
     * @dev Leaves the contract without governor. It will not be possible to call
     * `onlyGovernor` functions. Can only be called by the current governor.
     *
     * NOTE: Renouncing governance will leave the contract without an governor,
     * thereby disabling any functionality that is only available to the governor.
     */
    function renounceGovernance() public virtual onlyGovernor {
        _acceptGovernance(address(0));
    }

    /**
     * @dev Transfers governance of the contract to a new account (`newGovernor`).
     * Can only be called by the current governor.
     */
    function transferGovernance(address newGovernor) public virtual onlyGovernor {
        if (newGovernor == address(0)) {
            revert GovernableInvalidGovernor(address(0));
        }
        _transferGovernance(newGovernor);
    }

    /**
     * @dev mark trusted governor of the contract to a new account (`newGovernor`).
     * Internal function without access restriction.
     */
    function _transferGovernance(address newGovernor) internal virtual {
        _governorsTable[newGovernor] = true;
        emit GovernanceTransferStarted(_governor, newGovernor);
    }

    /**
     * @dev The new governor accepts the governance transfer.
     */
    function acceptGovernance() public virtual {
        if (!_governorsTable[msg.sender]) {
            revert GovernableUnauthorizedAccount(msg.sender);
        }
        _acceptGovernance(msg.sender);
    }

    /**
     * @dev Truly accept new governor then delete old governor from table
     */
    function _acceptGovernance(address newGovernor) internal virtual {
        address oldGovernor = _governor;
        _governor = newGovernor;
        // move newGovernor from table to _governor
        _governorsTable[newGovernor] = true;
        emit GovernanceTransferred(oldGovernor, newGovernor);
    }
}
