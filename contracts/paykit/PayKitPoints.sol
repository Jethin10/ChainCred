// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPayKitPoints} from "./interfaces/IPayKitPoints.sol";

/// @title PayKitPoints
/// @notice Universal loyalty points: one balance per wallet, earned at any PayKit merchant and
///         spendable at any other. Only the PaymentRouter can mint or burn, and only inside a
///         payment the customer signed. Points cannot be transferred.
/// @dev Exposes the ERC-20 read surface (name, symbol, decimals, balanceOf, totalSupply, Transfer
///      events) so wallets and the explorer show balances; every transfer function reverts.
contract PayKitPoints is IPayKitPoints, Ownable2Step {
    string public constant name = "PayKit Points";
    string public constant symbol = "PKP";
    uint8 public constant decimals = 0;

    struct PaymentPoints {
        address wallet;
        uint128 earned;
        uint128 redeemed;
        uint128 earnedReversed; // earned points already removed because of refunds
        uint128 redeemedRestored; // redeemed points already given back because of refunds
    }

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    mapping(address => uint256) public lifetimeEarned;
    mapping(address => uint256) public lifetimeRedeemed;
    mapping(bytes32 => PaymentPoints) public paymentPoints;

    address public router;
    /// @notice Platform-wide cap: at most this many points per 1 USDT (1e6 base units) paid.
    uint256 public maxPointsPerUsdt;

    // ERC-20 compatible
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    event PointsEarned(
        address indexed wallet, bytes32 indexed merchantId, bytes32 indexed paymentId, bytes32 campaignId, uint256 amount
    );
    event PointsRedeemed(
        address indexed wallet, bytes32 indexed merchantId, bytes32 indexed paymentId, bytes32 rewardId, uint256 amount
    );
    event PointsReversed(
        address indexed wallet, bytes32 indexed paymentId, uint256 earnedRemoved, uint256 redeemedRestored, uint256 shortfall
    );
    event RouterSet(address router);
    event MaxPointsPerUsdtSet(uint256 value);

    error NotRouter();
    error NonTransferable();
    error EarnRateTooHigh();
    error InsufficientPoints();
    error WalletMismatch();
    error InvalidAddress();

    constructor(address admin, uint256 maxPointsPerUsdt_) Ownable(admin) {
        maxPointsPerUsdt = maxPointsPerUsdt_;
        emit MaxPointsPerUsdtSet(maxPointsPerUsdt_);
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    // ───────────────────────── router hooks ─────────────────────────

    function earn(address wallet, bytes32 merchantId, bytes32 paymentId, bytes32 campaignId, uint256 points, uint256 grossUsdt)
        external
        onlyRouter
    {
        if (points == 0) return;
        if (points * 1e6 > grossUsdt * maxPointsPerUsdt) revert EarnRateTooHigh();
        PaymentPoints storage pp = _bind(paymentId, wallet);
        pp.earned += uint128(points);
        lifetimeEarned[wallet] += points;
        _mint(wallet, points);
        emit PointsEarned(wallet, merchantId, paymentId, campaignId, points);
    }

    function redeem(address wallet, bytes32 merchantId, bytes32 paymentId, bytes32 rewardId, uint256 points)
        external
        onlyRouter
    {
        if (points == 0) return;
        if (balanceOf[wallet] < points) revert InsufficientPoints();
        PaymentPoints storage pp = _bind(paymentId, wallet);
        pp.redeemed += uint128(points);
        lifetimeRedeemed[wallet] += points;
        _burn(wallet, points);
        emit PointsRedeemed(wallet, merchantId, paymentId, rewardId, points);
    }

    /// @notice Called after every refund with the payment's cumulative refunded amount. Removes the
    ///         same share of earned points and gives back the same share of redeemed points.
    ///         If the customer already spent the points to remove, the rest is recorded as shortfall.
    function onRefund(bytes32 paymentId, uint256 cumulativeRefunded, uint256 gross) external onlyRouter {
        PaymentPoints storage pp = paymentPoints[paymentId];
        if (pp.wallet == address(0) || gross == 0) return;
        if (cumulativeRefunded > gross) cumulativeRefunded = gross;

        uint256 earnedTarget = (uint256(pp.earned) * cumulativeRefunded) / gross;
        uint256 restoreTarget = (uint256(pp.redeemed) * cumulativeRefunded) / gross;
        uint256 toRemove = earnedTarget - pp.earnedReversed;
        uint256 toRestore = restoreTarget - pp.redeemedRestored;
        if (toRemove == 0 && toRestore == 0) return;
        pp.earnedReversed = uint128(earnedTarget);
        pp.redeemedRestored = uint128(restoreTarget);

        address w = pp.wallet;
        if (toRestore > 0) _mint(w, toRestore);
        uint256 removable = toRemove > balanceOf[w] ? balanceOf[w] : toRemove;
        if (removable > 0) _burn(w, removable);
        emit PointsReversed(w, paymentId, removable, toRestore, toRemove - removable);
    }

    // ───────────────────────── admin ─────────────────────────

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert InvalidAddress();
        router = router_;
        emit RouterSet(router_);
    }

    function setMaxPointsPerUsdt(uint256 value) external onlyOwner {
        maxPointsPerUsdt = value;
        emit MaxPointsPerUsdtSet(value);
    }

    // ───────────────────────── ERC-20 surface (non-transferable) ─────────────────────────

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    // ───────────────────────── internals ─────────────────────────

    function _bind(bytes32 paymentId, address wallet) internal returns (PaymentPoints storage pp) {
        pp = paymentPoints[paymentId];
        if (pp.wallet == address(0)) pp.wallet = wallet;
        else if (pp.wallet != wallet) revert WalletMismatch();
    }

    function _mint(address to, uint256 amount) internal {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
