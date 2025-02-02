// SPDX-License-Identifier: MIT

import '../libraries/math/SafeMath.sol';
import '../libraries/token/IERC20.sol';
import '../libraries/token/SafeERC20.sol';
import '../libraries/utils/ReentrancyGuard.sol';
import './interfaces/IVault.sol';
import './interfaces/IMilpManager.sol';
import '../tokens/interfaces/IMUSD.sol';
import '../tokens/interfaces/IMintable.sol';
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

pragma solidity ^0.8.18;

contract MilpManager is ReentrancyGuard, Governable, IMilpManager {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MUSD_DECIMALS = 18;
    uint256 public constant MAX_COOLDOWN_DURATION = 48 hours;

    IVault public vault;
    address public musd;
    address public milp;
    address public fulfillController;

    uint256 public override coolDownDuration;
    mapping(address => uint256) public override lastAddedAt;

    uint256 public aumAddition;
    uint256 public aumDeduction;

    bool public inPrivateMode;
    mapping(address => bool) public isHandler;

    event AddLiquidity(address account, address token, uint256 amount, uint256 aumInMusd, uint256 milpSupply, uint256 musdAmount, uint256 mintAmount);

    event RemoveLiquidity(address account, address token, uint256 milpAmount, uint256 aumInMusd, uint256 milpSupply, uint256 musdAmount, uint256 amountOut);

    constructor(address _vault, address _musd, address _milp, uint256 _coolDownDuration) Governable(msg.sender) {
        vault = IVault(_vault);
        musd = _musd;
        milp = _milp;
        coolDownDuration = _coolDownDuration;
    }

    function setInPrivateMode(bool _inPrivateMode) external onlyGovernor {
        inPrivateMode = _inPrivateMode;
    }

    function setHandler(address _handler, bool _isActive) external onlyGovernor {
        isHandler[_handler] = _isActive;
    }

    function setFulfillController(address _fulfillController) external onlyGovernor {
        require(_fulfillController != address(0), 'address invalid');

        isHandler[fulfillController] = false;
        fulfillController = _fulfillController;
        isHandler[fulfillController] = true;
    }

    function setCoolDownDuration(uint256 _coolDownDuration) external onlyGovernor {
        require(_coolDownDuration <= MAX_COOLDOWN_DURATION, 'MilpManager: invalid _coolDownDuration');
        coolDownDuration = _coolDownDuration;
    }

    function setAumAdjustment(uint256 _aumAddition, uint256 _aumDeduction) external onlyGovernor {
        aumAddition = _aumAddition;
        aumDeduction = _aumDeduction;
    }

    function addLiquidity(address _token, uint256 _amount, uint256 _minMusd, uint256 _minMilp) external override nonReentrant {
        if (inPrivateMode) {
            revert('MilpManager: action not enabled');
        }

        require(_amount > 0, 'MilpManager: invalid _amount');
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        IERC20(_token).approve(fulfillController, _amount);

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'handlerAddLiquidity(address,address,address,uint256,uint256,uint256)',
            fulfillController,
            msg.sender,
            _token,
            _amount,
            _minMusd,
            _minMilp
        );
        IFulfillController(fulfillController).requestOracleWithToken(data, msg.sender, _token, _amount, false, '');
    }

    function removeLiquidity(address _tokenOut, uint256 _milpAmount, uint256 _minOut, address _receiver) external override nonReentrant {
        if (inPrivateMode) {
            revert('MilpManager: action not enabled');
        }

        require(_milpAmount > 0, 'MilpManager: invalid _milpAmount');
        require(lastAddedAt[msg.sender].add(coolDownDuration) <= block.timestamp, 'MilpManager: coolDown duration not yet passed');

        // request oracle
        bytes memory data = abi.encodeWithSignature(
            'handlerRemoveLiquidity(address,address,address,uint256,uint256)',
            msg.sender,
            _receiver,
            _tokenOut,
            _milpAmount,
            _minOut
        );
        IFulfillController(fulfillController).requestOracle(data, msg.sender, '');
    }

    function handlerAddLiquidity(
        address _account,
        address _receiver,
        address _token,
        uint256 _amount,
        uint256 _minMusd,
        uint256 _minMilp
    ) external override returns (uint256) {
        _validateHandler();

        uint256 amount = _addLiquidity(_account, _receiver, _token, _amount, _minMusd, _minMilp);
        require(amount > 0, 'MilpManager: fulfill revert');
        return amount;
    }

    function handlerRemoveLiquidity(
        address _account,
        address _receiver,
        address _tokenOut,
        uint256 _milpAmount,
        uint256 _minOut
    ) external override returns (uint256) {
        _validateHandler();

        uint256 amount = _removeLiquidity(_account, _tokenOut, _milpAmount, _minOut, _receiver);
        require(amount > 0, 'MilpManager: fulfill revert');
        return amount;
    }

    function getAums() external view returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = getAum(true, false);
        amounts[1] = getAum(false, false);
        return amounts;
    }

    function getAumInMusd(bool maximise) public view returns (uint256) {
        uint256 aum = getAum(maximise, true);
        return aum.mul(10 ** MUSD_DECIMALS).div(PRICE_PRECISION);
    }

    function getAum(bool maximise, bool _validatePrice) public view returns (uint256) {
        uint256 length = vault.allWhitelistedTokensLength();
        uint256 aum = aumAddition;
        uint256 shortProfits = 0;

        for (uint256 i = 0; i < length; i++) {
            address token = vault.allWhitelistedTokens(i);
            bool isWhitelisted = vault.whitelistedTokens(token);

            if (!isWhitelisted) {
                continue;
            }

            uint256 price = maximise ? vault.getMaxPrice(token, _validatePrice) : vault.getMinPrice(token, _validatePrice);
            uint256 poolAmount = vault.poolAmounts(token);
            uint256 decimals = vault.tokenDecimals(token);

            if (vault.stableTokens(token)) {
                aum = aum.add(poolAmount.mul(price).div(10 ** decimals));
            } else {
                // add global short profit / loss
                uint256 size = vault.globalShortSizes(token);
                if (size > 0) {
                    uint256 averagePrice = vault.globalShortAveragePrices(token);
                    uint256 priceDelta = averagePrice > price ? averagePrice.sub(price) : price.sub(averagePrice);
                    uint256 delta = size.mul(priceDelta).div(averagePrice);
                    if (price > averagePrice) {
                        // add losses from shorts
                        aum = aum.add(delta);
                    } else {
                        shortProfits = shortProfits.add(delta);
                    }
                }

                aum = aum.add(vault.guaranteedUsd(token));

                uint256 reservedAmount = vault.reservedAmounts(token);
                aum = aum.add(poolAmount.sub(reservedAmount).mul(price).div(10 ** decimals));
            }
        }

        aum = shortProfits > aum ? 0 : aum.sub(shortProfits);
        return aumDeduction > aum ? 0 : aum.sub(aumDeduction);
    }

    function _addLiquidity(
        address _fundingAccount,
        address _account,
        address _token,
        uint256 _amount,
        uint256 _minMusd,
        uint256 _minMilp
    ) private returns (uint256) {
        require(_amount > 0, 'MilpManager: invalid _amount');

        // calculate aum before buyMUSD
        uint256 aumInMusd = getAumInMusd(true);
        uint256 milpSupply = IERC20(milp).totalSupply();

        IERC20(_token).safeTransferFrom(_fundingAccount, address(vault), _amount);
        uint256 musdAmount = vault.buyMUSD(_token, address(this));
        require(musdAmount >= _minMusd, 'MilpManager: insufficient MUSD output');

        uint256 mintAmount = aumInMusd == 0 ? musdAmount : musdAmount.mul(milpSupply).div(aumInMusd);
        require(mintAmount >= _minMilp, 'MilpManager: insufficient MILP output');

        IMintable(milp).mint(_account, mintAmount);

        lastAddedAt[_account] = block.timestamp;

        emit AddLiquidity(_account, _token, _amount, aumInMusd, milpSupply, musdAmount, mintAmount);

        return mintAmount;
    }

    function _removeLiquidity(address _account, address _tokenOut, uint256 _milpAmount, uint256 _minOut, address _receiver) private returns (uint256) {
        require(_milpAmount > 0, 'MilpManager: invalid _milpAmount');
        require(lastAddedAt[_account].add(coolDownDuration) <= block.timestamp, 'MilpManager: coolDown duration not yet passed');

        // calculate aum before sellMUSD
        uint256 aumInMusd = getAumInMusd(false);
        uint256 milpSupply = IERC20(milp).totalSupply();

        uint256 musdAmount = _milpAmount.mul(aumInMusd).div(milpSupply);
        uint256 musdBalance = IERC20(musd).balanceOf(address(this));
        if (musdAmount > musdBalance) {
            IMUSD(musd).mint(address(this), musdAmount.sub(musdBalance));
        }

        IMintable(milp).burn(_account, _milpAmount);

        IERC20(musd).transfer(address(vault), musdAmount);
        uint256 amountOut = vault.sellMUSD(_tokenOut, _receiver);
        require(amountOut >= _minOut, 'MilpManager: insufficient output');

        emit RemoveLiquidity(_account, _tokenOut, _milpAmount, aumInMusd, milpSupply, musdAmount, amountOut);

        return amountOut;
    }

    function _validateHandler() private view {
        require(isHandler[msg.sender], 'MilpManager: forbidden');
    }
}
