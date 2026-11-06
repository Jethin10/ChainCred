// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IMerchantRegistry} from "./interfaces/IMerchantRegistry.sol";
import {IUSDT3009} from "./interfaces/IUSDT3009.sol";
import {
    PayKitTypes,
    PaymentQuote,
    PayerAuth,
    RefundTerms,
    FunderAuth,
    PlanTerms,
    PayerConsent,
    PermitData,
    CancelPlan,
    PaymentKind
} from "./libraries/PayKitTypes.sol";

/// @title PaymentRouter
/// @notice All customer money flows through here: pay now, pay in parts, installments and refunds,
///         each with optional percentage splits. The router never keeps a balance.
contract PaymentRouter is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant DOWN_PAYMENT_INDEX = 0xFFFF;

    uint8 public constant PLAN_ACTIVE = 1;
    uint8 public constant PLAN_DELINQUENT = 2;
    uint8 public constant PLAN_CANCELLED = 3;
    uint8 public constant PLAN_COMPLETED = 4;

    // ───────────────────────────── types ─────────────────────────────

    struct FeeSchedule {
        uint16 bps;
        uint96 minFee;
        uint96 maxFee; // 0 = no max
    }

    struct InvoiceState {
        uint128 total;
        uint128 paid;
        uint128 refunded;
    }

    struct Payment {
        bytes32 merchantId;
        bytes32 invoiceKey; // 0 for plan payments
        bytes32 planId; // 0 for one-time
        address payer;
        address refundTo;
        address token;
        uint128 gross;
        uint128 fee;
        uint128 refunded;
        uint32 splitProfileId;
        uint64 settledAt;
    }

    struct Plan {
        bytes32 merchantId;
        address payer;
        address token;
        uint128 installmentAmount;
        uint128 feePerInstallment;
        uint64 firstDue;
        uint32 period;
        uint32 grace;
        uint16 count;
        uint16 collected;
        uint32 splitProfileId;
        uint8 status;
        bytes32 termsHash;
    }

    /// @dev In-memory bundle for the shared settlement path.
    struct Settlement {
        bytes32 paymentId;
        bytes32 merchantId;
        bytes32 invoiceKey;
        bytes32 planId;
        address payer;
        address refundTo;
        address token;
        uint256 gross;
        uint256 fee;
        uint32 splitProfileId;
        bytes32 quoteHash;
        PaymentKind kind;
    }

    // ───────────────────────────── storage ─────────────────────────────

    IMerchantRegistry public immutable registry;
    address public immutable treasury;

    mapping(address => bool) public allowedToken;
    mapping(address => FeeSchedule) public feeSchedule;

    mapping(bytes32 => InvoiceState) public invoices;
    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => bool) public usedRefundIds;
    mapping(bytes32 => Plan) public plans;
    mapping(address => mapping(address => uint256)) public committed; // payer => token => outstanding plan total

    // ───────────────────────────── events ─────────────────────────────

    event PaymentSettled(
        bytes32 indexed paymentId,
        bytes32 indexed merchantId,
        bytes32 indexed invoiceKey,
        bytes32 planId,
        address payer,
        address refundTo,
        address token,
        uint256 gross,
        uint256 fee,
        uint256 net,
        uint32 splitProfileId,
        bytes32 quoteHash,
        PaymentKind kind
    );
    event SplitPaid(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
    event InvoiceProgress(bytes32 indexed invoiceKey, uint256 total, uint256 paid, uint256 refunded);
    event RefundSettled(
        bytes32 indexed refundId,
        bytes32 indexed paymentId,
        address to,
        uint256 amount,
        uint256 fee,
        uint256 cumulativeRefunded,
        address funder
    );
    event PlanCreated(
        bytes32 indexed planId,
        bytes32 indexed merchantId,
        address indexed payer,
        address token,
        uint256 installmentAmount,
        uint16 count,
        uint32 period,
        uint64 firstDue,
        uint32 grace,
        bytes32 termsHash
    );
    event InstallmentCollected(bytes32 indexed planId, uint16 index, bytes32 paymentId, uint256 amount, uint256 fee);
    event InstallmentMissed(bytes32 indexed planId, uint16 index);
    event PlanCancelled(bytes32 indexed planId, address by);
    event PlanCompleted(bytes32 indexed planId);
    event FeeScheduleSet(address indexed token, uint16 bps, uint96 minFee, uint96 maxFee);
    event AllowedTokenSet(address indexed token, bool allowed);

    // ───────────────────────────── errors ─────────────────────────────

    error TokenNotAllowed();
    error MerchantInactive();
    error QuoteExpired();
    error PayerMismatch();
    error InvalidMerchantSignature();
    error InvalidPayerSignature();
    error PaymentAlreadySettled();
    error InvoiceTotalMismatch();
    error InvoiceOverpaid();
    error FeeBelowProtocolFloor();
    error FeeAboveMerchantCap();
    error FeeExceedsGross();
    error ZeroAmount();
    error UnknownPayment();
    error RefundIdUsed();
    error RefundExceedsPayment();
    error RefundExpired();
    error PlanExists();
    error InvalidPlan();
    error PlanNotActive();
    error InstallmentNotDue();
    error PlanComplete();
    error InsufficientAllowance();
    error NotDelinquentYet();
    error InvalidCancelSigner();
    error SignatureExpired();
    error InvalidFeeSchedule();
    error BalanceInvariant();
    error InvalidAddress();

    // ───────────────────────────── setup ─────────────────────────────

    constructor(address registry_, address treasury_, address admin)
        Ownable(admin)
        EIP712("PayKit Router", "1")
    {
        if (registry_ == address(0) || treasury_ == address(0)) revert InvalidAddress();
        registry = IMerchantRegistry(registry_);
        treasury = treasury_;
    }

    // ═════════════════════════════ Type 1 & 2: pay now / pay in parts ═════════════════════════════

    function pay(PaymentQuote calldata q, bytes calldata merchantSig, PayerAuth calldata a)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 paymentId)
    {
        if (!allowedToken[q.token]) revert TokenNotAllowed();
        if (!registry.isActive(q.merchantId)) revert MerchantInactive();
        if (block.timestamp > q.validUntil) revert QuoteExpired();
        if (q.payer != address(0) && q.payer != a.from) revert PayerMismatch();
        if (q.gross == 0) revert ZeroAmount();

        bytes32 quoteHash = _hashTypedDataV4(PayKitTypes.hashQuote(q));
        if (!_isMerchantSig(q.merchantId, quoteHash, merchantSig)) revert InvalidMerchantSignature();

        paymentId = paymentKeyOf(q.merchantId, q.paymentId);
        if (payments[paymentId].settledAt != 0) revert PaymentAlreadySettled();

        // Invoice: total is frozen by the first payment; parts can never exceed it.
        bytes32 key = invoiceKeyOf(q.merchantId, q.invoiceId);
        InvoiceState storage inv = invoices[key];
        if (inv.total == 0) {
            if (q.invoiceTotal == 0) revert InvoiceTotalMismatch();
            inv.total = q.invoiceTotal.toUint128();
        } else if (inv.total != q.invoiceTotal) {
            revert InvoiceTotalMismatch();
        }
        if (uint256(inv.paid) + q.gross > inv.total) revert InvoiceOverpaid();

        _checkFee(q.merchantId, q.token, q.gross, q.fee);

        address refundTo = a.refundTo == address(0) ? a.from : a.refundTo;

        // Effects
        inv.paid += uint128(q.gross); // safe: paid + gross <= total (uint128)
        Settlement memory s = Settlement({
            paymentId: paymentId,
            merchantId: q.merchantId,
            invoiceKey: key,
            planId: bytes32(0),
            payer: a.from,
            refundTo: refundTo,
            token: q.token,
            gross: q.gross,
            fee: q.fee,
            splitProfileId: q.splitProfileId,
            quoteHash: quoteHash,
            kind: PaymentKind.OneTime
        });
        _recordPayment(s);

        // Interactions. The nonce commits to the quote, the refund address and the salt:
        // change any of them and the payer's signature no longer matches.
        bytes32 nonce = keccak256(abi.encode(PayKitTypes.PAY_NONCE_TAG, quoteHash, refundTo, a.salt));
        uint256 before = IERC20(q.token).balanceOf(address(this));
        IUSDT3009(q.token).receiveWithAuthorization(
            a.from, address(this), q.gross, a.validAfter, a.validBefore, nonce, a.signature
        );
        _payout(s, before);

        emit InvoiceProgress(key, inv.total, inv.paid, inv.refunded);
    }

    // ═════════════════════════════ Type 4: refund ═════════════════════════════

    /// @notice Not pause-gated: refunds always work.
    function refund(RefundTerms calldata t, bytes calldata merchantSig, FunderAuth calldata f)
        external
        nonReentrant
        returns (uint128 cumulativeRefunded)
    {
        Payment storage p = payments[t.paymentId];
        if (p.settledAt == 0) revert UnknownPayment();
        if (usedRefundIds[t.refundId]) revert RefundIdUsed();
        if (block.timestamp > t.validUntil) revert RefundExpired();
        if (t.amount == 0) revert ZeroAmount();

        bytes32 termsHash = _hashTypedDataV4(PayKitTypes.hashRefund(t));
        if (!_isMerchantSig(p.merchantId, termsHash, merchantSig)) revert InvalidMerchantSignature();
        if (uint256(p.refunded) + t.amount > p.gross) revert RefundExceedsPayment();

        // Effects
        usedRefundIds[t.refundId] = true;
        p.refunded += uint128(t.amount); // safe: <= gross (uint128)
        cumulativeRefunded = p.refunded;
        bytes32 invoiceKey = p.invoiceKey;
        if (invoiceKey != bytes32(0)) {
            InvoiceState storage inv = invoices[invoiceKey];
            inv.refunded += uint128(t.amount);
            emit InvoiceProgress(invoiceKey, inv.total, inv.paid, inv.refunded);
        }

        // Interactions
        IERC20 token = IERC20(p.token);
        address to = p.refundTo;
        bytes32 nonce = keccak256(abi.encode(PayKitTypes.REFUND_NONCE_TAG, termsHash));
        uint256 before = token.balanceOf(address(this));
        IUSDT3009(address(token)).receiveWithAuthorization(
            t.funder, address(this), t.amount + t.fee, f.validAfter, f.validBefore, nonce, f.signature
        );
        token.safeTransfer(to, t.amount);
        if (t.fee > 0) token.safeTransfer(treasury, t.fee);
        if (token.balanceOf(address(this)) != before) revert BalanceInvariant();

        emit RefundSettled(t.refundId, t.paymentId, to, t.amount, t.fee, cumulativeRefunded, t.funder);
    }

    // ═════════════════════════════ Type 3: installments ═════════════════════════════

    function createPlan(
        PlanTerms calldata t,
        bytes calldata merchantSig,
        PayerConsent calldata consent,
        PermitData calldata permit
    ) external nonReentrant whenNotPaused returns (bytes32 planId) {
        if (!allowedToken[t.token]) revert TokenNotAllowed();
        if (!registry.isActive(t.merchantId)) revert MerchantInactive();
        if (block.timestamp > t.validUntil) revert QuoteExpired();
        if (t.payer == address(0) || t.count == 0 || t.period == 0 || t.installmentAmount == 0) revert InvalidPlan();

        planId = planKeyOf(t.merchantId, t.planId);
        if (plans[planId].payer != address(0)) revert PlanExists();

        bytes32 termsHash = _hashTypedDataV4(PayKitTypes.hashPlan(t));
        if (!_isMerchantSig(t.merchantId, termsHash, merchantSig)) revert InvalidMerchantSignature();
        if (block.timestamp > consent.deadline) revert SignatureExpired();
        bytes32 consentDigest = _hashTypedDataV4(PayKitTypes.hashConsent(termsHash, t.payer, consent.deadline));
        if (!SignatureChecker.isValidSignatureNow(t.payer, consentDigest, consent.signature)) {
            revert InvalidPayerSignature();
        }

        _checkFee(t.merchantId, t.token, t.installmentAmount, t.feePerInstallment);
        if (t.downPayment > 0) _checkFee(t.merchantId, t.token, t.downPayment, t.downPaymentFee);

        uint256 total = t.downPayment + t.installmentAmount * t.count;

        // Permit can be front-run (griefing); tolerate failure if the allowance is already there.
        try IUSDT3009(t.token).permit(t.payer, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s)
        {} catch {}

        uint256 newCommitted = committed[t.payer][t.token] + total;
        if (IERC20(t.token).allowance(t.payer, address(this)) < newCommitted) revert InsufficientAllowance();
        committed[t.payer][t.token] = newCommitted;

        plans[planId] = Plan({
            merchantId: t.merchantId,
            payer: t.payer,
            token: t.token,
            installmentAmount: t.installmentAmount.toUint128(),
            feePerInstallment: t.feePerInstallment.toUint128(),
            firstDue: t.firstDue,
            period: t.period,
            grace: t.grace,
            count: t.count,
            collected: 0,
            splitProfileId: t.splitProfileId,
            status: PLAN_ACTIVE,
            termsHash: termsHash
        });
        emit PlanCreated(
            planId, t.merchantId, t.payer, t.token, t.installmentAmount, t.count, t.period, t.firstDue, t.grace, termsHash
        );

        if (t.downPayment > 0) {
            committed[t.payer][t.token] -= t.downPayment;
            Settlement memory s = Settlement({
                paymentId: installmentPaymentId(planId, DOWN_PAYMENT_INDEX),
                merchantId: t.merchantId,
                invoiceKey: bytes32(0),
                planId: planId,
                payer: t.payer,
                refundTo: t.payer,
                token: t.token,
                gross: t.downPayment,
                fee: t.downPaymentFee,
                splitProfileId: t.splitProfileId,
                quoteHash: termsHash,
                kind: PaymentKind.DownPayment
            });
            _recordPayment(s);
            uint256 before = IERC20(t.token).balanceOf(address(this));
            IERC20(t.token).safeTransferFrom(t.payer, address(this), t.downPayment);
            _payout(s, before);
        }
    }

    /// @notice Permissionless: our scheduler calls it when an installment is due.
    function collectInstallment(bytes32 planId) external nonReentrant whenNotPaused returns (bytes32 paymentId) {
        Plan storage p = plans[planId];
        if (p.status != PLAN_ACTIVE && p.status != PLAN_DELINQUENT) revert PlanNotActive();
        if (p.collected >= p.count) revert PlanComplete();
        if (!registry.isActive(p.merchantId)) revert MerchantInactive();
        uint256 due = uint256(p.firstDue) + uint256(p.collected) * p.period;
        if (block.timestamp < due) revert InstallmentNotDue();

        uint16 index = p.collected;
        paymentId = installmentPaymentId(planId, index);
        p.collected = index + 1;
        committed[p.payer][p.token] -= p.installmentAmount;
        bool completed = p.collected == p.count;
        p.status = completed ? PLAN_COMPLETED : PLAN_ACTIVE;

        Settlement memory s = Settlement({
            paymentId: paymentId,
            merchantId: p.merchantId,
            invoiceKey: bytes32(0),
            planId: planId,
            payer: p.payer,
            refundTo: p.payer,
            token: p.token,
            gross: p.installmentAmount,
            fee: p.feePerInstallment,
            splitProfileId: p.splitProfileId,
            quoteHash: p.termsHash,
            kind: PaymentKind.Installment
        });
        _recordPayment(s);
        uint256 before = IERC20(s.token).balanceOf(address(this));
        IERC20(s.token).safeTransferFrom(s.payer, address(this), s.gross);
        _payout(s, before);

        emit InstallmentCollected(planId, index, paymentId, s.gross, s.fee);
        if (completed) emit PlanCompleted(planId);
    }

    /// @notice Permissionless: flags a plan whose current installment is past due + grace.
    function markDelinquent(bytes32 planId) external {
        Plan storage p = plans[planId];
        if (p.status != PLAN_ACTIVE) revert PlanNotActive();
        if (p.collected >= p.count) revert PlanComplete();
        uint256 due = uint256(p.firstDue) + uint256(p.collected) * p.period;
        if (block.timestamp <= due + p.grace) revert NotDelinquentYet();
        p.status = PLAN_DELINQUENT;
        emit InstallmentMissed(planId, p.collected);
    }

    /// @notice Payer or merchant (owner/signer) cancels. Not pause-gated.
    function cancelPlan(CancelPlan calldata c, bytes calldata sig) external {
        Plan storage p = plans[c.planId];
        if (p.status != PLAN_ACTIVE && p.status != PLAN_DELINQUENT) revert PlanNotActive();
        if (block.timestamp > c.deadline) revert SignatureExpired();
        bytes32 digest = _hashTypedDataV4(PayKitTypes.hashCancel(c));
        bool allowed = c.signer == p.payer || registry.isAuthorized(p.merchantId, c.signer);
        if (!allowed || !SignatureChecker.isValidSignatureNow(c.signer, digest, sig)) revert InvalidCancelSigner();

        uint256 remaining = uint256(p.installmentAmount) * (p.count - p.collected);
        committed[p.payer][p.token] -= remaining;
        p.status = PLAN_CANCELLED;
        emit PlanCancelled(c.planId, c.signer);
    }

    // ═════════════════════════════ admin ═════════════════════════════

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit AllowedTokenSet(token, allowed);
    }

    function setFeeSchedule(address token, uint16 bps, uint96 minFee, uint96 maxFee) external onlyOwner {
        if (bps > BPS || (maxFee != 0 && maxFee < minFee)) revert InvalidFeeSchedule();
        feeSchedule[token] = FeeSchedule({bps: bps, minFee: minFee, maxFee: maxFee});
        emit FeeScheduleSet(token, bps, minFee, maxFee);
    }

    /// @notice Stops new money coming in (pay, createPlan, collectInstallment). Refunds and cancels still work.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ═════════════════════════════ views ═════════════════════════════

    function protocolFee(address token, uint256 gross) public view returns (uint256 fee) {
        FeeSchedule memory s = feeSchedule[token];
        fee = (gross * s.bps) / BPS;
        if (fee < s.minFee) fee = s.minFee;
        if (s.maxFee != 0 && fee > s.maxFee) fee = s.maxFee;
    }

    function invoiceKeyOf(bytes32 merchantId, bytes32 invoiceId) public pure returns (bytes32) {
        return keccak256(abi.encode(merchantId, invoiceId));
    }

    function paymentKeyOf(bytes32 merchantId, bytes32 localPaymentId) public pure returns (bytes32) {
        return keccak256(abi.encode(PayKitTypes.ONE_TIME_TAG, merchantId, localPaymentId));
    }

    function planKeyOf(bytes32 merchantId, bytes32 localPlanId) public pure returns (bytes32) {
        return keccak256(abi.encode(PayKitTypes.PLAN_TAG, merchantId, localPlanId));
    }

    function installmentPaymentId(bytes32 planId, uint256 index) public pure returns (bytes32) {
        return keccak256(abi.encode(PayKitTypes.INSTALLMENT_TAG, planId, index));
    }

    /// @notice EIP-712 digests, for the server to cross-check its own hashing.
    function quoteDigest(PaymentQuote calldata q) external view returns (bytes32) {
        return _hashTypedDataV4(PayKitTypes.hashQuote(q));
    }

    function refundDigest(RefundTerms calldata t) external view returns (bytes32) {
        return _hashTypedDataV4(PayKitTypes.hashRefund(t));
    }

    function planDigest(PlanTerms calldata t) external view returns (bytes32) {
        return _hashTypedDataV4(PayKitTypes.hashPlan(t));
    }

    function payNonce(bytes32 quoteHash, address refundTo, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encode(PayKitTypes.PAY_NONCE_TAG, quoteHash, refundTo, salt));
    }

    function refundNonce(bytes32 refundTermsHash) external pure returns (bytes32) {
        return keccak256(abi.encode(PayKitTypes.REFUND_NONCE_TAG, refundTermsHash));
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ═════════════════════════════ internals ═════════════════════════════

    function _checkFee(bytes32 merchantId, address token, uint256 gross, uint256 fee) internal view {
        if (fee > gross) revert FeeExceedsGross();
        if (fee < protocolFee(token, gross)) revert FeeBelowProtocolFloor();
        if (fee * BPS > gross * registry.maxFeeBpsOf(merchantId)) revert FeeAboveMerchantCap();
    }

    /// @dev Signer must be the merchant owner or an active quote signer (ECDSA),
    ///      or the owner may be a contract wallet (ERC-1271, e.g. a Safe).
    function _isMerchantSig(bytes32 merchantId, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err == ECDSA.RecoverError.NoError && registry.isAuthorized(merchantId, recovered)) return true;
        address owner_ = registry.merchantOwner(merchantId);
        return owner_.code.length > 0 && SignatureChecker.isValidERC1271SignatureNow(owner_, digest, sig);
    }

    function _recordPayment(Settlement memory s) internal {
        if (payments[s.paymentId].settledAt != 0) revert PaymentAlreadySettled();
        payments[s.paymentId] = Payment({
            merchantId: s.merchantId,
            invoiceKey: s.invoiceKey,
            planId: s.planId,
            payer: s.payer,
            refundTo: s.refundTo,
            token: s.token,
            gross: s.gross.toUint128(),
            fee: s.fee.toUint128(),
            refunded: 0,
            splitProfileId: s.splitProfileId,
            settledAt: uint64(block.timestamp)
        });
    }

    /// @dev Pays the split from the registry (last recipient gets the rounding remainder),
    ///      sends the fee to the treasury and asserts the router balance is unchanged.
    function _payout(Settlement memory s, uint256 balanceBefore) internal {
        IERC20 token = IERC20(s.token);
        uint256 net = s.gross - s.fee;
        (address[] memory recipients, uint16[] memory bps) = registry.getSplit(s.merchantId, s.splitProfileId);
        uint256 remaining = net;
        uint256 last = recipients.length - 1;
        for (uint256 i; i < recipients.length; ++i) {
            uint256 amount = i == last ? remaining : (net * bps[i]) / BPS;
            remaining -= amount;
            if (amount > 0) token.safeTransfer(recipients[i], amount);
            emit SplitPaid(s.paymentId, recipients[i], amount);
        }
        if (s.fee > 0) token.safeTransfer(treasury, s.fee);
        if (token.balanceOf(address(this)) != balanceBefore) revert BalanceInvariant();

        emit PaymentSettled(
            s.paymentId,
            s.merchantId,
            s.invoiceKey,
            s.planId,
            s.payer,
            s.refundTo,
            s.token,
            s.gross,
            s.fee,
            net,
            s.splitProfileId,
            s.quoteHash,
            s.kind
        );
    }
}
