// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMerchantRegistry {
    function isActive(bytes32 merchantId) external view returns (bool);

    /// @notice True if `account` is the merchant owner or an enabled, unexpired quote signer.
    function isAuthorized(bytes32 merchantId, address account) external view returns (bool);

    function merchantOwner(bytes32 merchantId) external view returns (address);

    function maxFeeBpsOf(bytes32 merchantId) external view returns (uint16);

    function getSplit(bytes32 merchantId, uint32 profileId)
        external
        view
        returns (address[] memory recipients, uint16[] memory bps);
}
