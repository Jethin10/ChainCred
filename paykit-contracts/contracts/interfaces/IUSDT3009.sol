// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The subset of TetherTokenV2 (testnet USDT 0xcedf…55a7) that PayKit calls.
interface IUSDT3009 is IERC20 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;

    function cancelAuthorization(address authorizer, bytes32 nonce, bytes calldata signature) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;

    function nonces(address owner) external view returns (uint256);

    function isBlocked(address account) external view returns (bool);
}
