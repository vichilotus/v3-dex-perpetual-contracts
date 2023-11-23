//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice Wrapper of IERC20 for having mint function
 */
interface IMintableERC20 is IERC20 {
    function mint2Address(address to, uint256 amount) external returns (bool);

    function mint(uint256 amount) external returns (bool);

    function transferOperator(address newOperator) external;
}

contract EmpyreanChef is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for IMintableERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        uint256 rewardLockedUp; // Reward locked up.
        uint256 nextHarvestUntil; // When can the user harvest again.
        uint256 lastInteraction; // Last time when user deposited or claimed rewards, renewing the lock
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken; // Address of LP token contract
        uint256 allocPoint; // How many allocation points assigned to this pool. EMPY to distribute per block.
        uint256 lastRewardBlock; // Last block number that EMPY distribution occurs.
        uint256 accRewardPerShare; // Accumulated EMPY per share, times 1e12. See below.
        uint16 depositFeeBP; // Deposit fee in basis points
        uint16 withdrawFeeBP; // Withdraw fee in basis points
        uint256 harvestInterval; // Harvest interval in seconds
        uint256 totalLp; // Total token in Pool
        uint256 lockupDuration; // Amount of time the participant will be locked in the pool after depositing or claiming rewards
    }

    IMintableERC20 public immutable empyToken;

    // Fee receiver
    address public feeAddress;
    // Dev wallet
    address public devAddress;

    address private BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // EMPY tokens created per block
    uint256 public empyPerBlock;

    // Max harvest interval: 21 days
    uint256 public constant MAXIMUM_HARVEST_INTERVAL = 21 days;

    // Max lock period: 30 days
    uint256 public constant MAXIMUM_LOCK_DURATION = 30 days;

    // Maximum deposit fee rate: 10%
    uint16 public constant MAXIMUM_DEPOSIT_FEE_RATE = 1000;

    // Maximum withdraw fee rate: 10%
    uint16 public constant MAXIMUM_WITHDRAW_FEE_RATE = 1000;

    // Maximum dev reward rate: 12%
    uint16 public constant MAXIMUM_DEV_REWARD_RATE = 1200;

    // Dev reward rate 10%
    uint16 public devRewardRate = 1000;

    // Info of each pool
    PoolInfo[] public poolInfo;

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // The block number when EMPY mining starts.
    uint256 public startBlock;

    // Total locked up rewards
    uint256 public totalLockedUpRewards;

    // Total EMPY in Reward Pools (can be multiple pools)
    uint256 public totalRewardInPools = 0;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        uint256 amount
    );
    event EmissionRateUpdated(
        address indexed caller,
        uint256 previousAmount,
        uint256 newAmount
    );
    event RewardLockedUp(
        address indexed user,
        uint256 indexed pid,
        uint256 amountLockedUp
    );
    event DevRewardRateChanged(
        address indexed caller,
        uint16 oldRate,
        uint16 newRate
    );
    event DevAddressChanged(
        address indexed caller,
        address oldAddress,
        address newAddress
    );
    event FeeAddressChanged(
        address indexed caller,
        address oldAddress,
        address newAddress
    );

    constructor(
        address _empyToken,
        address _feeAddress,
        address _devAddress,
        uint256 _empyPerBlock
    ) {
        require(_feeAddress != address(0), "Invalid fee address");
        require(_devAddress != address(0), "Invalid dev address");
        require(_empyPerBlock > 0, "Invalid empy per block");

        //StartBlock always many years later from contract construct, will be set later in StartFarming function
        startBlock = block.number.add(3650 days);

        empyToken = IMintableERC20(_empyToken);
        empyPerBlock = _empyPerBlock;

        feeAddress = _feeAddress;
        devAddress = _devAddress;
    }

    /**
     * @notice Return reward multiplier over the given _from to _to block.
     */
    function getMultiplier(
        uint256 _from,
        uint256 _to
    ) public pure returns (uint256) {
        return _to.sub(_from);
    }

    /**
     * @notice Set farming start, can call only once
     */
    function startFarming() public onlyOwner {
        require(block.number < startBlock, "Error: farm started already");

        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            PoolInfo storage pool = poolInfo[pid];
            pool.lastRewardBlock = block.number;
        }

        startBlock = block.number;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @notice Add a new lp to the pool. Can only be called by the owner.
     * Can add multiple pool with same lp token without messing up rewards,
     * because each pool's balance is tracked using its own totalLp
     */
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        uint16 _depositFeeBP,
        uint16 _withdrawFeeBP,
        uint256 _harvestInterval,
        uint256 _lockupDuration,
        bool _withUpdate
    ) external onlyOwner {
        require(
            _depositFeeBP <= MAXIMUM_DEPOSIT_FEE_RATE,
            "Deposit fee too high"
        );
        require(
            _withdrawFeeBP <= MAXIMUM_WITHDRAW_FEE_RATE,
            "Withdraw fee too high"
        );
        require(
            _harvestInterval <= MAXIMUM_HARVEST_INTERVAL,
            "Harvest interval too long"
        );
        require(
            _lockupDuration <= MAXIMUM_LOCK_DURATION,
            "Lockup duration too long"
        );
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock
            ? block.number
            : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(
            PoolInfo({
                lpToken: _lpToken,
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accRewardPerShare: 0,
                depositFeeBP: _depositFeeBP,
                withdrawFeeBP: _withdrawFeeBP,
                harvestInterval: _harvestInterval,
                totalLp: 0,
                lockupDuration: _lockupDuration
            })
        );
    }

    /**
     * @notice Update pool configuration
     */
    function updatePoolConfiguration(
        uint256 _pid,
        uint256 _allocPoint,
        uint16 _depositFeeBP,
        uint16 _withdrawFeeBP,
        uint256 _harvestInterval,
        uint256 _lockupDuration,
        bool _withUpdate
    ) external onlyOwner {
        require(
            _depositFeeBP <= MAXIMUM_DEPOSIT_FEE_RATE,
            "Deposit fee too high"
        );
        require(
            _withdrawFeeBP <= MAXIMUM_WITHDRAW_FEE_RATE,
            "Withdraw fee too high"
        );
        require(
            _harvestInterval <= MAXIMUM_HARVEST_INTERVAL,
            "Harvest interval too long"
        );
        require(
            _lockupDuration <= MAXIMUM_LOCK_DURATION,
            "Lockup duration too long"
        );
        if (_withUpdate) {
            massUpdatePools();
        }

        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(
            _allocPoint
        );
        poolInfo[_pid].allocPoint = _allocPoint;
        poolInfo[_pid].depositFeeBP = _depositFeeBP;
        poolInfo[_pid].withdrawFeeBP = _withdrawFeeBP;
        poolInfo[_pid].harvestInterval = _harvestInterval;
        poolInfo[_pid].lockupDuration = _lockupDuration;
    }

    /**
     * @notice View function to see pending EMPY on frontend.
     */
    function pendingReward(
        uint256 _pid,
        address _user
    ) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.totalLp;

        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = getMultiplier(
                pool.lastRewardBlock,
                block.number
            );
            uint256 empyReward = multiplier
                .mul(empyPerBlock)
                .mul(pool.allocPoint)
                .div(totalAllocPoint);
            accRewardPerShare = accRewardPerShare.add(
                empyReward.mul(1e12).div(lpSupply)
            );
        }

        uint256 pending = user.amount.mul(accRewardPerShare).div(1e12).sub(
            user.rewardDebt
        );
        return pending.add(user.rewardLockedUp);
    }

    /**
     * @notice View function to see when user will be unlocked from pool
     */
    function userLockedUntil(
        uint256 _pid,
        address _user
    ) external view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        PoolInfo storage pool = poolInfo[_pid];

        return user.lastInteraction.add(pool.lockupDuration);
    }

    /**
     * @notice View function to see if user can harvest EMPY.
     */
    function canHarvest(
        uint256 _pid,
        address _user
    ) public view returns (bool) {
        UserInfo storage user = userInfo[_pid][_user];
        return
            block.number >= startBlock &&
            block.timestamp >= user.nextHarvestUntil;
    }

    /**
     * @notice Update reward vairables for all pools. Be careful of gas spending!
     */
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /**
     * @notice Update reward variables of the given pool to be up-to-date.
     */
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }

        uint256 lpSupply = pool.totalLp;
        if (lpSupply == 0 || pool.allocPoint == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
        uint256 empyReward = multiplier
            .mul(empyPerBlock)
            .mul(pool.allocPoint)
            .div(totalAllocPoint);

        empyToken.mint2Address(devAddress, empyReward.div(10));
        empyToken.mint2Address(address(this), empyReward);

        pool.accRewardPerShare = pool.accRewardPerShare.add(
            empyReward.mul(1e12).div(pool.totalLp)
        );
        pool.lastRewardBlock = block.number;
    }

    /**
     * @notice Deposit LP tokens to farm and get rewards
     */
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant {
        require(
            block.number >= startBlock,
            "Cannot deposit before farming start"
        );

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];

        updatePool(_pid);
        payOrLockupPendingReward(_pid);

        if (_amount > 0) {
            uint256 beforeDeposit = pool.lpToken.balanceOf(address(this));
            pool.lpToken.safeTransferFrom(_msgSender(), address(this), _amount);
            uint256 afterDeposit = pool.lpToken.balanceOf(address(this));

            _amount = afterDeposit.sub(beforeDeposit);

            if (pool.depositFeeBP > 0) {
                uint256 depositFee = _amount.mul(pool.depositFeeBP).div(10000);
                if (depositFee > 0) {
                    pool.lpToken.safeTransfer(feeAddress, depositFee);
                    _amount = _amount.sub(depositFee);
                }
            }

            user.amount = user.amount.add(_amount);
            pool.totalLp = pool.totalLp.add(_amount);

            if (address(pool.lpToken) == address(empyToken)) {
                totalRewardInPools = totalRewardInPools.add(_amount);
            }
        }
        user.rewardDebt = user.amount.mul(pool.accRewardPerShare).div(1e12);
        user.lastInteraction = block.timestamp;
        emit Deposit(_msgSender(), _pid, _amount);
    }

    /**
     * @notice Withdraw tokens
     */
    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];

        // this will make sure that user can only withdraw from his pool
        require(user.amount >= _amount, "Withdraw: user amount is not enough");

        // Cannot withdraw more than pool's balance
        require(pool.totalLp >= _amount, "Withdraw: pool total is not enough");

        updatePool(_pid);
        payOrLockupPendingReward(_pid);

        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.totalLp = pool.totalLp.sub(_amount);
            if (address(pool.lpToken) == address(empyToken)) {
                totalRewardInPools = totalRewardInPools.sub(_amount);
            }

            // Withdraw before lock time needs withdraw fee
            if (
                block.timestamp < user.lastInteraction.add(pool.lockupDuration)
            ) {
                uint256 withdrawFee = _amount.mul(pool.withdrawFeeBP).div(
                    10000
                );
                if (withdrawFee > 0) {
                    pool.lpToken.safeTransfer(feeAddress, withdrawFee);
                    _amount = _amount.sub(withdrawFee);
                }
            }

            if (_amount > 0) {
                pool.lpToken.safeTransfer(_msgSender(), _amount);
            }
        }
        user.rewardDebt = user.amount.mul(pool.accRewardPerShare).div(1e12);
        user.lastInteraction = block.timestamp;
        emit Withdraw(_msgSender(), _pid, _amount);
    }

    /**
     * @notice Withdraw without caring about rewards. EMERGENCY ONLY.
     */
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];
        uint256 amount = user.amount;

        //Cannot withdraw more than pool's balance
        require(
            pool.totalLp >= amount,
            "emergency withdraw: pool total not enough"
        );

        user.amount = 0;
        user.rewardDebt = 0;
        user.rewardLockedUp = 0;
        user.nextHarvestUntil = 0;
        pool.totalLp -= amount;

        if (address(pool.lpToken) == address(empyToken)) {
            totalRewardInPools = totalRewardInPools.sub(amount);
        }

        // Withdraw before lock time needs withdraw fee
        if (block.timestamp < user.lastInteraction.add(pool.lockupDuration)) {
            uint256 withdrawFee = amount.mul(pool.withdrawFeeBP).div(10000);
            if (withdrawFee > 0) {
                pool.lpToken.safeTransfer(feeAddress, withdrawFee);
                amount = amount.sub(withdrawFee);
            }
        }

        pool.lpToken.safeTransfer(_msgSender(), amount);

        emit EmergencyWithdraw(_msgSender(), _pid, amount);
    }

    /**
     * @notice Pay or lockup pending EMPY.
     */
    function payOrLockupPendingReward(uint256 _pid) private {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];

        if (user.nextHarvestUntil == 0 && block.number >= startBlock) {
            user.nextHarvestUntil = block.timestamp.add(pool.harvestInterval);
        }

        uint256 pending = user.amount.mul(pool.accRewardPerShare).div(1e12).sub(
            user.rewardDebt
        );
        if (canHarvest(_pid, _msgSender())) {
            if (pending > 0 || user.rewardLockedUp > 0) {
                uint256 totalRewards = pending.add(user.rewardLockedUp);
                // send rewards
                uint256 rewardsTransferred = safeRewardTransfer(
                    _msgSender(),
                    totalRewards
                );
                uint256 rewardsUnTransferred = totalRewards.sub(
                    rewardsTransferred
                );

                // reset lockup
                totalLockedUpRewards = totalLockedUpRewards
                    .sub(user.rewardLockedUp)
                    .add(rewardsUnTransferred);
                user.rewardLockedUp = rewardsUnTransferred;
                user.nextHarvestUntil = block.timestamp.add(
                    pool.harvestInterval
                );
            }
        } else if (pending > 0) {
            user.rewardLockedUp = user.rewardLockedUp.add(pending);
            totalLockedUpRewards = totalLockedUpRewards.add(pending);
            emit RewardLockedUp(_msgSender(), _pid, pending);
        }
    }

    /**
     * @notice Safe EMPY transfer function, just in case if rounding error causes pool do not have enough EMPY.
     */
    function safeRewardTransfer(
        address _to,
        uint256 _amount
    ) private returns (uint256) {
        uint256 totalRewardInContract = empyToken.balanceOf(address(this));
        if (_amount > 0 && totalRewardInContract > totalRewardInPools) {
            // RewardBal = total Reward in RewardVault - total Reward in Reward pools,
            // this will make sure that RewardVault never transfer rewards from deposited Reward pools
            uint256 empyBal = totalRewardInContract.sub(totalRewardInPools);
            if (_amount >= empyBal) {
                _amount = empyBal;
            }

            empyToken.safeTransfer(_to, _amount);
            return _amount;
        }
        return 0;
    }

    /**
     * @notice Set fee address
     */
    function setFeeAddress(address _feeAddress) external onlyOwner {
        require(_feeAddress != address(0), "Invalid fee address");

        emit FeeAddressChanged(_msgSender(), feeAddress, _feeAddress);

        feeAddress = _feeAddress;
    }

    /**
     * @notice Set dev address
     */
    function setDevAddress(address _devAddress) external onlyOwner {
        require(_devAddress != address(0), "Invalid dev address");

        emit DevAddressChanged(_msgSender(), devAddress, _devAddress);

        devAddress = _devAddress;
    }

    /**
     * @notice Set dev reward rate
     */
    function setDevRewardRate(uint16 _devRewardRate) external onlyOwner {
        require(
            _devRewardRate <= MAXIMUM_DEV_REWARD_RATE,
            "Invalid dev reward rate"
        );

        emit DevRewardRateChanged(_msgSender(), devRewardRate, _devRewardRate);

        devRewardRate = _devRewardRate;
    }

    /**
     * @notice Update emission rate
     */
    function updateEmissionRate(uint256 _empyPerBlock) external onlyOwner {
        massUpdatePools();

        emit EmissionRateUpdated(_msgSender(), empyPerBlock, _empyPerBlock);
        empyPerBlock = _empyPerBlock;
    }

    // Revoke UniswapV2Token function, return onwership of token to origin
    function revokeUniswapV2Token(address _origin) external onlyOwner {
        empyToken.transferOperator(_origin);
    }

    /**
     * @notice call back function to receive ETH
     */
    receive() external payable {}
}
