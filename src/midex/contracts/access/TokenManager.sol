//SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../libraries/math/SafeMath.sol';
import '../libraries/token/IERC20.sol';
import '../libraries/utils/ReentrancyGuard.sol';
import '../peripherals/interfaces/ITimeLock.sol';

contract TokenManager is ReentrancyGuard {
    using SafeMath for uint256;

    bool public isInitialized;

    uint256 public actionsNonce;
    uint256 public minAuthorizations;

    address public admin;

    address[] public signers;
    mapping(address => bool) public isSigner;
    mapping(bytes32 => bool) public pendingActions;
    mapping(address => mapping(bytes32 => bool)) public signedActions;

    event SignalApprove(address token, address spender, uint256 amount, bytes32 action, uint256 nonce);
    event SignalSetAdmin(address target, address admin, bytes32 action, uint256 nonce);
    event SignalTransferGovernance(address timeLock, address target, address governor, bytes32 action, uint256 nonce);
    event SignalPendingAction(bytes32 action, uint256 nonce);
    event SignAction(bytes32 action, uint256 nonce);
    event ClearAction(bytes32 action, uint256 nonce);

    constructor(uint256 _minAuthorizations) {
        admin = msg.sender;
        minAuthorizations = _minAuthorizations;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, 'TokenManager: forbidden');
        _;
    }

    modifier onlySigner() {
        require(isSigner[msg.sender], 'TokenManager: forbidden');
        _;
    }

    function initialize(address[] memory _signers) public virtual onlyAdmin {
        require(!isInitialized, 'TokenManager: already initialized');
        isInitialized = true;

        signers = _signers;
        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            isSigner[signer] = true;
        }
    }

    function signersLength() public view returns (uint256) {
        return signers.length;
    }

    function signalApprove(address _token, address _spender, uint256 _amount) external nonReentrant onlyAdmin {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked('approve', _token, _spender, _amount, nonce));
        _setPendingAction(action, nonce);
        emit SignalApprove(_token, _spender, _amount, action, nonce);
    }

    function signApprove(address _token, address _spender, uint256 _amount, uint256 _nonce) external nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked('approve', _token, _spender, _amount, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], 'TokenManager: already signed');
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function approve(address _token, address _spender, uint256 _amount, uint256 _nonce) external nonReentrant onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('approve', _token, _spender, _amount, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        IERC20(_token).approve(_spender, _amount);
        _clearAction(action, _nonce);
    }

    function signalSetAdmin(address _target, address _admin) external nonReentrant onlySigner {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked('setAdmin', _target, _admin, nonce));
        _setPendingAction(action, nonce);
        signedActions[msg.sender][action] = true;
        emit SignalSetAdmin(_target, _admin, action, nonce);
    }

    function signSetAdmin(address _target, address _admin, uint256 _nonce) external nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked('setAdmin', _target, _admin, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], 'TokenManager: already signed');
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function setAdmin(address _target, address _admin, uint256 _nonce) external nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked('setAdmin', _target, _admin, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        ITimeLock(_target).setAdmin(_admin);
        _clearAction(action, _nonce);
    }

    function signalTransferGovernance(address _timeLock, address _target, address _governor) external nonReentrant onlyAdmin {
        actionsNonce++;
        uint256 nonce = actionsNonce;
        bytes32 action = keccak256(abi.encodePacked('signalTransferGovernance', _timeLock, _target, _governor, nonce));
        _setPendingAction(action, nonce);
        signedActions[msg.sender][action] = true;
        emit SignalTransferGovernance(_timeLock, _target, _governor, action, nonce);
    }

    function signalTransferGovernance(address _timeLock, address _target, address _governor, uint256 _nonce) external nonReentrant onlySigner {
        bytes32 action = keccak256(abi.encodePacked('signalTransferGovernance', _timeLock, _target, _governor, _nonce));
        _validateAction(action);
        require(!signedActions[msg.sender][action], 'TokenManager: already signed');
        signedActions[msg.sender][action] = true;
        emit SignAction(action, _nonce);
    }

    function transferGovernance(address _timeLock, address _target, address _governor, uint256 _nonce) external nonReentrant onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked('signalTransferGovernance', _timeLock, _target, _governor, _nonce));
        _validateAction(action);
        _validateAuthorization(action);

        ITimeLock(_timeLock).signalTransferGovernance(_target, _governor);
        _clearAction(action, _nonce);
    }

    function _setPendingAction(bytes32 _action, uint256 _nonce) private {
        pendingActions[_action] = true;
        emit SignalPendingAction(_action, _nonce);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action], 'TokenManager: action not signalled');
    }

    function _validateAuthorization(bytes32 _action) private view {
        uint256 count = 0;
        for (uint256 i = 0; i < signers.length; i++) {
            address signer = signers[i];
            if (signedActions[signer][_action]) {
                count++;
            }
        }

        if (count == 0) {
            revert('TokenManager: action not authorized');
        }
        require(count >= minAuthorizations, 'TokenManager: insufficient authorization');
    }

    function _clearAction(bytes32 _action, uint256 _nonce) private {
        require(pendingActions[_action], 'TokenManager: invalid _action');
        delete pendingActions[_action];
        emit ClearAction(_action, _nonce);
    }
}
