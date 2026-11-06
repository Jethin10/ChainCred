// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPayKitPoints {
    function earn(address wallet, bytes32 merchantId, bytes32 paymentId, bytes32 campaignId, uint256 points, uint256 grossUsdt)
        external;

    function redeem(address wallet, bytes32 merchantId, bytes32 paymentId, bytes32 rewardId, uint256 points) external;

    function onRefund(bytes32 paymentId, uint256 cumulativeRefunded, uint256 gross) external;
}
