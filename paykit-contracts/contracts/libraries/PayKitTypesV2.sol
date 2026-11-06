// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice v2 quote: v1 fields plus discount and universal points.
/// EIP-712 type name stays "PaymentQuote"; the router's domain version is "2".
struct PaymentQuoteV2 {
    bytes32 merchantId;
    bytes32 invoiceId;
    bytes32 invoiceDigest;
    bytes32 paymentId;
    address token;
    uint256 invoiceTotal;
    uint256 gross; // USDT actually paid by the customer
    uint256 fee;
    address payer;
    uint32 splitProfileId;
    uint64 validUntil;
    uint256 discount; // USDT value the merchant waives; counts toward the invoice total
    uint256 pointsEarned; // points minted to the payer for this payment (issuer's campaign)
    bytes32 campaignId;
    uint256 pointsRedeemed; // points burned from the payer for this payment (redeemer's reward)
    bytes32 rewardId;
}

/// @notice v2 plan terms: v1 fields plus points per charge.
struct PlanTermsV2 {
    bytes32 merchantId;
    bytes32 planId;
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
    uint256 pointsPerCharge; // points earned on every scheduled charge
    uint256 downPaymentPoints; // points earned on the charge taken at sign-up
    bytes32 campaignId;
}

library PayKitTypesV2 {
    bytes32 internal constant PAYMENT_QUOTE_TYPEHASH = keccak256(
        "PaymentQuote(bytes32 merchantId,bytes32 invoiceId,bytes32 invoiceDigest,bytes32 paymentId,address token,uint256 invoiceTotal,uint256 gross,uint256 fee,address payer,uint32 splitProfileId,uint64 validUntil,uint256 discount,uint256 pointsEarned,bytes32 campaignId,uint256 pointsRedeemed,bytes32 rewardId)"
    );
    bytes32 internal constant PLAN_TERMS_TYPEHASH = keccak256(
        "PlanTerms(bytes32 merchantId,bytes32 planId,bytes32 invoiceDigest,address payer,address token,uint256 downPayment,uint256 installmentAmount,uint256 feePerInstallment,uint256 downPaymentFee,uint16 count,uint32 period,uint64 firstDue,uint32 grace,uint32 splitProfileId,uint8 kind,uint64 validUntil,uint256 pointsPerCharge,uint256 downPaymentPoints,bytes32 campaignId)"
    );

    // Split into chunks to keep the stack shallow; every field is one 32-byte word, so the bytes
    // are identical to a single abi.encode.
    function hashQuote(PaymentQuoteV2 calldata q) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(PAYMENT_QUOTE_TYPEHASH, q.merchantId, q.invoiceId, q.invoiceDigest, q.paymentId, q.token),
                abi.encode(q.invoiceTotal, q.gross, q.fee, q.payer, q.splitProfileId, q.validUntil),
                abi.encode(q.discount, q.pointsEarned, q.campaignId, q.pointsRedeemed, q.rewardId)
            )
        );
    }

    function hashPlan(PlanTermsV2 calldata t) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(PLAN_TERMS_TYPEHASH, t.merchantId, t.planId, t.invoiceDigest, t.payer, t.token, t.downPayment),
                abi.encode(t.installmentAmount, t.feePerInstallment, t.downPaymentFee, t.count, t.period, t.firstDue),
                abi.encode(t.grace, t.splitProfileId, t.kind, t.validUntil, t.pointsPerCharge, t.downPaymentPoints, t.campaignId)
            )
        );
    }
}
