// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Merchant-signed terms for one payment (one-time or one part of an invoice).
struct PaymentQuote {
    bytes32 merchantId;
    bytes32 invoiceId; // keccak256(utf8(invoice UUID))
    bytes32 invoiceDigest; // keccak256(canonical invoice JSON)
    bytes32 paymentId; // merchant-local id; the onchain key is keccak256(ONE_TIME_TAG, merchantId, paymentId)
    address token;
    uint256 invoiceTotal;
    uint256 gross;
    uint256 fee;
    address payer; // 0 = any payer
    uint32 splitProfileId;
    uint64 validUntil;
}

/// @notice The payer's EIP-3009 ReceiveWithAuthorization (USDT domain), plus fields bound into its nonce.
struct PayerAuth {
    address from;
    address refundTo; // 0 = refund to `from`
    bytes32 salt;
    uint256 validAfter;
    uint256 validBefore;
    bytes signature;
}

struct RefundTerms {
    bytes32 paymentId; // onchain payment key
    bytes32 refundId;
    uint256 amount;
    uint256 fee;
    address funder;
    uint64 validUntil;
}

struct FunderAuth {
    uint256 validAfter;
    uint256 validBefore;
    bytes signature;
}

struct PlanTerms {
    bytes32 merchantId;
    bytes32 planId; // merchant-local id; the onchain key is keccak256(PLAN_TAG, merchantId, planId)
    bytes32 invoiceDigest;
    address payer;
    address token;
    uint256 downPayment;
    uint256 installmentAmount;
    uint256 feePerInstallment;
    uint256 downPaymentFee;
    uint16 count;
    uint32 period;
    uint64 firstDue;
    uint32 grace;
    uint32 splitProfileId;
    uint8 kind;
    uint64 validUntil;
}

struct PayerConsent {
    uint64 deadline;
    bytes signature;
}

struct PermitData {
    uint256 value;
    uint256 deadline;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

struct CancelPlan {
    bytes32 planId; // onchain plan key
    address signer;
    uint64 deadline;
}

enum PaymentKind {
    OneTime,
    Installment,
    DownPayment
}

library PayKitTypes {
    bytes32 internal constant PAYMENT_QUOTE_TYPEHASH = keccak256(
        "PaymentQuote(bytes32 merchantId,bytes32 invoiceId,bytes32 invoiceDigest,bytes32 paymentId,address token,uint256 invoiceTotal,uint256 gross,uint256 fee,address payer,uint32 splitProfileId,uint64 validUntil)"
    );
    bytes32 internal constant REFUND_TERMS_TYPEHASH = keccak256(
        "RefundTerms(bytes32 paymentId,bytes32 refundId,uint256 amount,uint256 fee,address funder,uint64 validUntil)"
    );
    bytes32 internal constant PLAN_TERMS_TYPEHASH = keccak256(
        "PlanTerms(bytes32 merchantId,bytes32 planId,bytes32 invoiceDigest,address payer,address token,uint256 downPayment,uint256 installmentAmount,uint256 feePerInstallment,uint256 downPaymentFee,uint16 count,uint32 period,uint64 firstDue,uint32 grace,uint32 splitProfileId,uint8 kind,uint64 validUntil)"
    );
    bytes32 internal constant PLAN_CONSENT_TYPEHASH =
        keccak256("PlanConsent(bytes32 termsHash,address payer,uint64 deadline)");
    bytes32 internal constant CANCEL_PLAN_TYPEHASH =
        keccak256("CancelPlan(bytes32 planId,address signer,uint64 deadline)");

    bytes32 internal constant PAY_NONCE_TAG = keccak256("PayKit.pay.v1");
    bytes32 internal constant REFUND_NONCE_TAG = keccak256("PayKit.refund.v1");
    bytes32 internal constant ONE_TIME_TAG = keccak256("PayKit.payment.v1");
    bytes32 internal constant PLAN_TAG = keccak256("PayKit.plan.v1");
    bytes32 internal constant INSTALLMENT_TAG = keccak256("PayKit.installment.v1");

    // abi.encode is split in two halves to keep the stack shallow; the bytes are identical
    // to a single abi.encode because every field is a static 32-byte word.
    function hashQuote(PaymentQuote calldata q) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(PAYMENT_QUOTE_TYPEHASH, q.merchantId, q.invoiceId, q.invoiceDigest, q.paymentId, q.token),
                abi.encode(q.invoiceTotal, q.gross, q.fee, q.payer, q.splitProfileId, q.validUntil)
            )
        );
    }

    function hashRefund(RefundTerms calldata t) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(REFUND_TERMS_TYPEHASH, t.paymentId, t.refundId, t.amount, t.fee, t.funder, t.validUntil)
        );
    }

    function hashPlan(PlanTerms calldata t) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    PLAN_TERMS_TYPEHASH,
                    t.merchantId,
                    t.planId,
                    t.invoiceDigest,
                    t.payer,
                    t.token,
                    t.downPayment,
                    t.installmentAmount,
                    t.feePerInstallment
                ),
                abi.encode(
                    t.downPaymentFee, t.count, t.period, t.firstDue, t.grace, t.splitProfileId, t.kind, t.validUntil
                )
            )
        );
    }

    function hashConsent(bytes32 termsHash, address payer, uint64 deadline) internal pure returns (bytes32) {
        return keccak256(abi.encode(PLAN_CONSENT_TYPEHASH, termsHash, payer, deadline));
    }

    function hashCancel(CancelPlan calldata c) internal pure returns (bytes32) {
        return keccak256(abi.encode(CANCEL_PLAN_TYPEHASH, c.planId, c.signer, c.deadline));
    }
}
