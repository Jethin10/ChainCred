// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02, IWETH} from "./interfaces/ISwapRouter02.sol";

/// @title FeeTreasury
/// @notice Holds protocol USDT fees and converts them into native WBT for the relay node in bounded runs.
/// @dev Swap path: USDT -> WWBT via SwapRouter02 (recipient = this), then WWBT.withdraw() and send native
///      WBT to the calling relayer. This avoids depending on SwapRouter02.unwrapWETH9 / ADDRESS_THIS (gate G4).
contract FeeTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct RefillLimits {
        uint128 maxUsdtPerRun; // base units (6 dp)
        uint128 maxUsdtPerDay; // base units (6 dp)
        uint128 minWbtPerUsdt; // price floor: wei of WBT per 1 USDT (1e6 base units)
        uint32 maxDeadlineWindow; // seconds
    }

    IERC20 public immutable usdt;
    address public immutable wwbt;
    ISwapRouter02 public immutable swapRouter;
    uint24 public immutable poolFee;

    RefillLimits public limits;
    mapping(address => bool) public isRelayer;
    uint256 public spentToday;
    uint64 public dayStart;
    uint256 public reservedUsdt; // the admin can never withdraw below this
    uint256 public runCount;

    event Refill(
        uint256 indexed runId,
        uint256 usdtIn,
        uint256 wbtOut,
        address indexed recipient,
        uint256 minWbtOut,
        uint256 timestamp
    );
    event LimitsSet(uint128 maxUsdtPerRun, uint128 maxUsdtPerDay, uint128 minWbtPerUsdt, uint32 maxDeadlineWindow);
    event RelayerSet(address indexed relayer, bool enabled);
    event ReservedUsdtSet(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotRelayer();
    error LimitsNotSet();
    error ZeroAmount();
    error AboveRunCap();
    error AboveDailyCap();
    error BadDeadline();
    error BelowPriceFloor();
    error InsufficientFees();
    error SlippageExceeded();
    error NativeTransferFailed();
    error OnlyWWBT();
    error AboveWithdrawable();
    error InvalidAddress();

    constructor(address usdt_, address wwbt_, address swapRouter_, uint24 poolFee_, address admin) Ownable(admin) {
        if (usdt_ == address(0) || wwbt_ == address(0) || swapRouter_ == address(0)) revert InvalidAddress();
        usdt = IERC20(usdt_);
        wwbt = wwbt_;
        swapRouter = ISwapRouter02(swapRouter_);
        poolFee = poolFee_;
    }

    /// @notice Only accepts native WBT from WWBT.withdraw().
    receive() external payable {
        if (msg.sender != wwbt) revert OnlyWWBT();
    }

    /// @notice Swap `usdtIn` of fees to native WBT, paid to the calling relayer.
    /// @param minWbtOut must also clear the admin price floor (minWbtPerUsdt).
    /// @param deadline must be within maxDeadlineWindow of now.
    function refill(uint256 usdtIn, uint256 minWbtOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 wbtOut)
    {
        if (!isRelayer[msg.sender]) revert NotRelayer();
        RefillLimits memory l = limits;
        if (l.maxUsdtPerRun == 0 || l.minWbtPerUsdt == 0) revert LimitsNotSet();
        if (usdtIn == 0) revert ZeroAmount();
        if (usdtIn > l.maxUsdtPerRun) revert AboveRunCap();

        if (block.timestamp >= uint256(dayStart) + 1 days) {
            dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
            spentToday = 0;
        }
        if (spentToday + usdtIn > l.maxUsdtPerDay) revert AboveDailyCap();
        if (deadline < block.timestamp || deadline > block.timestamp + l.maxDeadlineWindow) revert BadDeadline();
        if (minWbtOut < (usdtIn * l.minWbtPerUsdt) / 1e6) revert BelowPriceFloor();
        if (usdt.balanceOf(address(this)) < usdtIn) revert InsufficientFees();

        spentToday += usdtIn;

        uint256 wBefore = IERC20(wwbt).balanceOf(address(this));
        usdt.forceApprove(address(swapRouter), usdtIn);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(
            ISwapRouter02.exactInputSingle,
            (
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: address(usdt),
                    tokenOut: wwbt,
                    fee: poolFee,
                    recipient: address(this),
                    amountIn: usdtIn,
                    amountOutMinimum: minWbtOut,
                    sqrtPriceLimitX96: 0
                })
            )
        );
        swapRouter.multicall(deadline, calls);
        usdt.forceApprove(address(swapRouter), 0);

        wbtOut = IERC20(wwbt).balanceOf(address(this)) - wBefore;
        if (wbtOut < minWbtOut) revert SlippageExceeded();

        IWETH(wwbt).withdraw(wbtOut);
        (bool ok,) = payable(msg.sender).call{value: wbtOut}("");
        if (!ok) revert NativeTransferFailed();

        emit Refill(++runCount, usdtIn, wbtOut, msg.sender, minWbtOut, block.timestamp);
    }

    // ───────────────────────────── admin ─────────────────────────────

    function setLimits(RefillLimits calldata l) external onlyOwner {
        limits = l;
        emit LimitsSet(l.maxUsdtPerRun, l.maxUsdtPerDay, l.minWbtPerUsdt, l.maxDeadlineWindow);
    }

    function setRelayer(address relayer, bool enabled) external onlyOwner {
        if (relayer == address(0)) revert InvalidAddress();
        isRelayer[relayer] = enabled;
        emit RelayerSet(relayer, enabled);
    }

    function setReservedUsdt(uint256 amount) external onlyOwner {
        reservedUsdt = amount;
        emit ReservedUsdtSet(amount);
    }

    /// @notice Withdraw fee revenue above the operating reserve.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        if (amount + reservedUsdt > usdt.balanceOf(address(this))) revert AboveWithdrawable();
        usdt.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice USDT the refill node may draw on (whole balance; the reserve only limits admin withdrawals).
    function availableFees() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
