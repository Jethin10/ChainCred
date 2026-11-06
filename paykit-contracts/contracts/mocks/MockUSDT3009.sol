// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Test stand-in for TetherTokenV2: 6 decimals, EIP-2612 permit, EIP-3009
///         receiveWithAuthorization / cancelAuthorization, and a blocklist.
///         EIP-712 domain: name "Tether USD", version "1" (same as the real token).
contract MockUSDT3009 is ERC20Permit {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;
    mapping(address => bool) public isBlocked;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    constructor() ERC20("Tether USD", "USDT") ERC20Permit("Tether USD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool blocked) external {
        isBlocked[account] = blocked;
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(to == msg.sender, "caller must be the payee");
        require(block.timestamp > validAfter, "authorization is not yet valid");
        require(block.timestamp < validBefore, "authorization is expired");
        require(!_authorizationStates[from][nonce], "authorization is used or canceled");
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        require(SignatureChecker.isValidSignatureNow(from, _hashTypedDataV4(structHash), signature), "invalid signature");
        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) external {
        require(!_authorizationStates[authorizer][nonce], "authorization is used or canceled");
        bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));
        require(
            SignatureChecker.isValidSignatureNow(authorizer, _hashTypedDataV4(structHash), signature),
            "invalid signature"
        );
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!isBlocked[from] && !isBlocked[to], "blocked");
        super._update(from, to, value);
    }
}
