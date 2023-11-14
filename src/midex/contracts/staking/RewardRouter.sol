// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import '../libraries/math/SafeMath.sol';
import '../libraries/token/IERC20.sol';
import '../libraries/token/SafeERC20.sol';
import '../libraries/utils/ReentrancyGuard.sol';
import '../libraries/utils/Address.sol';
import './interfaces/IRewardTracker.sol';
import '../tokens/interfaces/IMintable.sol';
import '../tokens/interfaces/IWETH.sol';
import '../core/interfaces/IMilpManager.sol';
import '../access/Governable.sol';

interface IFulfillController {
    function requestOracle(bytes memory _data, address _account, bytes memory _revertHandler) external;

    function requestOracleWithToken(
        bytes memory _data,
        address _account,
        address _token,
        uint256 _amount,
        bool _transferETH,
        bytes memory _revertHandler
    ) external;
}

contract RewardRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;
    address public weth;
    address public milp; // TFX Liquidity Provider token
    address public feeMilpTracker;
    address public milpManager;
    address public fulfillController;

    mapping(address => address) public pendingReceivers;

    uint256 public minRewardCompound;

    modifier onlyFulfillController() {
        require(msg.sender == fulfillController, 'FulfillController: forbidden');
        _;
    }

    event StakeMilp(address account, uint256 amount);
    event UnstakeMilp(address account, uint256 amount);

    constructor() Governable(msg.sender) {}

    receive() external payable {
        require(msg.sender == weth, 'Router: invalid sender');
    }

    function initialize(address _weth, address _milp, address _feeMilpTracker, address _milpManager, uint256 _minRewardCompound) external onlyGovernor {
        require(!isInitialized, 'RewardRouter: already initialized');
        isInitialized = true;
        weth = _weth;
        milp = _milp;
        feeMilpTracker = _feeMilpTracker;
        milpManager = _milpManager;
        minRewardCompound = _minRewardCompound;
    }

    function setFulfillController(address _fulfillController) external onlyGovernor {
        require(_fulfillController != address(0), 'address invalid');
        fulfillController = _fulfillController;
    }

    function setMinRewardCompound(uint256 _minRewardCompound) external onlyGovernor {
        minRewardCompound = _minRewardCompound;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGovernor {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function mintAndStakeMilp(address _token, uint256 _amount, uint256 _minMusd, uint256 _minMilp) external nonReentrant {
        require(_amount > 0, 'RewardRouter: invalid _amount');
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        IERC20(_token).approve(fulfillController, _amount);

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'fulfillMintAndStakeMilp(address,address,uint256,uint256,uint256)',
            msg.sender,
            _token,
            _amount,
            _minMusd,
            _minMilp
        );
        IFulfillController(fulfillController).requestOracleWithToken(data, msg.sender, _token, _amount, false, '');
    }

    function mintAndStakeMilpETH(uint256 _minMusd, uint256 _minMilp) external payable nonReentrant {
        require(msg.value > 0, 'RewardRouter: invalid msg.value');
        uint256 amount = msg.value;
        IWETH(weth).deposit{value: amount}();
        IERC20(weth).approve(fulfillController, amount);

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'fulfillMintAndStakeMilp(address,address,uint256,uint256,uint256)',
            msg.sender,
            weth,
            amount,
            _minMusd,
            _minMilp
        );
        IFulfillController(fulfillController).requestOracleWithToken(data, msg.sender, weth, amount, true, '');
    }

    function unStakeAndRedeemMilp(address _tokenOut, uint256 _milpAmount, uint256 _minOut, address _receiver) external nonReentrant {
        require(_milpAmount > 0, 'RewardRouter: invalid _milpAmount');

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'fulfillUnStakeAndRedeemMilp(address,address,uint256,uint256,address)',
            msg.sender,
            _tokenOut,
            _milpAmount,
            _minOut,
            _receiver
        );
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function unStakeAndRedeemMilpETH(uint256 _milpAmount, uint256 _minOut, address _receiver) external nonReentrant {
        require(_milpAmount > 0, 'RewardRouter: invalid _milpAmount');

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'fulfillUnStakeAndRedeemMilpETH(address,uint256,uint256,address)',
            msg.sender,
            _milpAmount,
            _minOut,
            _receiver
        );
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function fulfillMintAndStakeMilp(
        address _account,
        address _token,
        uint256 _amount,
        uint256 _minMusd,
        uint256 _minMilp
    ) external onlyFulfillController returns (uint256) {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        IERC20(_token).approve(milpManager, _amount);

        uint256 milpAmount = IMilpManager(milpManager).handlerAddLiquidity(address(this), _account, _token, _amount, _minMusd, _minMilp);
        IRewardTracker(feeMilpTracker).stakeForAccount(_account, _account, milp, milpAmount);

        emit StakeMilp(_account, milpAmount);

        return milpAmount;
    }

    function fulfillUnStakeAndRedeemMilp(
        address _account,
        address _tokenOut,
        uint256 _milpAmount,
        uint256 _minOut,
        address _receiver
    ) external onlyFulfillController returns (uint256) {
        IRewardTracker(feeMilpTracker).unStakeForAccount(_account, milp, _milpAmount, _account);

        uint256 amountOut = IMilpManager(milpManager).handlerRemoveLiquidity(_account, _receiver, _tokenOut, _milpAmount, _minOut);

        emit UnstakeMilp(_account, _milpAmount);

        return amountOut;
    }

    function fulfillUnStakeAndRedeemMilpETH(
        address _account,
        uint256 _milpAmount,
        uint256 _minOut,
        address payable _receiver
    ) external onlyFulfillController returns (uint256) {
        IRewardTracker(feeMilpTracker).unStakeForAccount(_account, milp, _milpAmount, _account);

        uint256 amountOut = IMilpManager(milpManager).handlerRemoveLiquidity(_account, address(this), weth, _milpAmount, _minOut);

        IWETH(weth).withdraw(amountOut);
        _receiver.sendValue(amountOut);

        emit UnstakeMilp(_receiver, _milpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;
        IRewardTracker(feeMilpTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(address _account) external nonReentrant onlyGovernor {
        _compound(_account);
    }

    function _compound(address _account) private {
        uint256 rewardAmount = IRewardTracker(feeMilpTracker).claimable(_account);
        require(rewardAmount > minRewardCompound, 'RewardRouter: reward to compound too small');

        // request oracle
        bytes memory data = abi.encodeWithSignature('fulfillCompound(address)', _account);
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function fulfillCompound(address _account) external onlyFulfillController {
        uint256 rewardAmount = IRewardTracker(feeMilpTracker).claimForAccount(_account, address(this));

        if (rewardAmount > 0) {
            IERC20(weth).approve(milpManager, rewardAmount);
            uint256 milpAmount = IMilpManager(milpManager).handlerAddLiquidity(address(this), _account, weth, rewardAmount, 0, 0);

            IRewardTracker(feeMilpTracker).stakeForAccount(_account, _account, milp, milpAmount);

            emit StakeMilp(_account, milpAmount);
        }
    }

    function handleRewards(bool _shouldConvertWethToEth) external nonReentrant {
        address account = msg.sender;

        if (_shouldConvertWethToEth) {
            uint256 wethAmount = IRewardTracker(feeMilpTracker).claimForAccount(account, address(this));
            IWETH(weth).withdraw(wethAmount);

            payable(account).sendValue(wethAmount);
        } else {
            IRewardTracker(feeMilpTracker).claimForAccount(account, account);
        }
    }

    function signalTransfer(address _receiver) external nonReentrant {
        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        address receiver = msg.sender;
        require(pendingReceivers[_sender] == receiver, 'RewardRouter: transfer not signalled');
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);

        uint256 milpAmount = IRewardTracker(feeMilpTracker).depositBalances(_sender, milp);
        if (milpAmount > 0) {
            IRewardTracker(feeMilpTracker).unStakeForAccount(_sender, milp, milpAmount, _sender);
            IRewardTracker(feeMilpTracker).stakeForAccount(_sender, receiver, milp, milpAmount);
        }
    }

    function _validateReceiver(address _receiver) private view {
        require(IRewardTracker(feeMilpTracker).averageStakedAmounts(_receiver) == 0, 'RewardRouter: feeMilpTracker.averageStakedAmounts > 0');
        require(IRewardTracker(feeMilpTracker).cumulativeRewards(_receiver) == 0, 'RewardRouter: feeMilpTracker.cumulativeRewards > 0');
    }
}
