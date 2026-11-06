// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IMerchantRegistry} from "./interfaces/IMerchantRegistry.sol";

/// @title MerchantRegistry
/// @notice Source of truth for who a merchant is, where its money goes, who may sign quotes
///         for it, and which domains the platform has verified for it.
contract MerchantRegistry is IMerchantRegistry, Ownable2Step, EIP712 {
    // ───────────────────────────── types ─────────────────────────────

    uint8 public constant STATUS_NONE = 0;
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_SUSPENDED = 2;

    uint16 internal constant BPS = 10_000;
    uint256 public constant MAX_SPLIT_RECIPIENTS = 5;

    struct Merchant {
        address owner;
        address payout;
        uint16 maxFeeBps;
        uint8 status;
        uint64 createdAt;
        bytes32 metadataHash;
        string metadataURI;
    }

    struct SignerInfo {
        uint64 expiresAt; // 0 = never
        bool enabled;
    }

    struct SplitProfile {
        address[] recipients;
        uint16[] bps;
        bool active;
    }

    struct DomainAttestation {
        uint64 verifiedAt;
        uint64 expiresAt;
        address attestor;
    }

    struct PendingPayout {
        address newPayout;
        uint64 executableAt;
    }

    // Gasless (relayed) request structs. Each is signed by the merchant owner.
    struct RegisterMerchant {
        address owner;
        address payout;
        uint16 maxFeeBps;
        bytes32 metadataHash;
        string metadataURI;
        uint256 nonce;
        uint64 deadline;
    }

    struct SetSigner {
        bytes32 merchantId;
        address signer;
        uint64 expiresAt;
        bool enabled;
        uint256 nonce;
        uint64 deadline;
    }

    struct QueuePayout {
        bytes32 merchantId;
        address newPayout;
        uint256 nonce;
        uint64 deadline;
    }

    /// @dev Signed as SetSplitProfile{merchantId, profileId, splitHash, nonce, deadline},
    ///      where splitHash = keccak256(abi.encode(recipients, bps)).
    struct SetSplitRequest {
        bytes32 merchantId;
        uint32 profileId;
        address[] recipients;
        uint16[] bps;
        uint256 nonce;
        uint64 deadline;
    }

    struct SetMetadata {
        bytes32 merchantId;
        bytes32 metadataHash;
        string metadataURI;
        uint256 nonce;
        uint64 deadline;
    }

    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "RegisterMerchant(address owner,address payout,uint16 maxFeeBps,bytes32 metadataHash,string metadataURI,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant SET_SIGNER_TYPEHASH = keccak256(
        "SetSigner(bytes32 merchantId,address signer,uint64 expiresAt,bool enabled,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant QUEUE_PAYOUT_TYPEHASH =
        keccak256("QueuePayout(bytes32 merchantId,address newPayout,uint256 nonce,uint64 deadline)");
    bytes32 public constant SET_SPLIT_TYPEHASH = keccak256(
        "SetSplitProfile(bytes32 merchantId,uint32 profileId,bytes32 splitHash,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant SET_METADATA_TYPEHASH = keccak256(
        "SetMetadata(bytes32 merchantId,bytes32 metadataHash,string metadataURI,uint256 nonce,uint64 deadline)"
    );

    // ───────────────────────────── storage ─────────────────────────────

    mapping(bytes32 => Merchant) internal _merchants;
    mapping(bytes32 => mapping(address => SignerInfo)) public signers;
    mapping(bytes32 => mapping(uint32 => SplitProfile)) internal _splits; // profile 0 = 100% payout (implicit)
    mapping(bytes32 => mapping(bytes32 => DomainAttestation)) public domains; // merchantId => domainHash => attestation
    mapping(bytes32 => PendingPayout) public pendingPayout;
    mapping(bytes32 => address) public pendingMerchantOwner;
    mapping(address => uint256) public ownerNonces;
    mapping(address => bool) public isAttestor;
    uint64 public payoutChangeDelay;

    // ───────────────────────────── events ─────────────────────────────

    event MerchantRegistered(
        bytes32 indexed merchantId,
        address indexed owner,
        address payout,
        uint16 maxFeeBps,
        bytes32 metadataHash,
        string metadataURI
    );
    event SignerSet(bytes32 indexed merchantId, address indexed signer, uint64 expiresAt, bool enabled);
    event PayoutChangeQueued(bytes32 indexed merchantId, address newPayout, uint64 executableAt);
    event PayoutChanged(bytes32 indexed merchantId, address oldPayout, address newPayout);
    event SplitProfileSet(bytes32 indexed merchantId, uint32 indexed profileId, address[] recipients, uint16[] bps);
    event MetadataUpdated(bytes32 indexed merchantId, bytes32 metadataHash, string metadataURI);
    event MaxFeeBpsSet(bytes32 indexed merchantId, uint16 maxFeeBps);
    event DomainAttested(bytes32 indexed merchantId, bytes32 indexed domainHash, uint64 expiresAt, address attestor);
    event DomainRevoked(bytes32 indexed merchantId, bytes32 indexed domainHash);
    event MerchantStatusChanged(bytes32 indexed merchantId, uint8 status);
    event MerchantOwnershipTransferStarted(bytes32 indexed merchantId, address newOwner);
    event MerchantOwnershipTransferred(bytes32 indexed merchantId, address oldOwner, address newOwner);
    event AttestorSet(address indexed attestor, bool enabled);
    event PayoutChangeDelaySet(uint64 delay);

    // ───────────────────────────── errors ─────────────────────────────

    error NotMerchantOwner();
    error UnknownMerchant();
    error MerchantExists();
    error InvalidAddress();
    error InvalidFeeBps();
    error InvalidSplit();
    error InvalidStatus();
    error SignatureExpired();
    error InvalidNonce();
    error InvalidSignature();
    error NoPendingPayout();
    error PayoutChangeNotReady();
    error NotAttestor();
    error NotPendingOwner();
    error InvalidExpiry();

    // ───────────────────────────── setup ─────────────────────────────

    constructor(address admin, uint64 payoutChangeDelay_) Ownable(admin) EIP712("PayKit Registry", "1") {
        payoutChangeDelay = payoutChangeDelay_;
        emit PayoutChangeDelaySet(payoutChangeDelay_);
    }

    modifier onlyMerchantOwner(bytes32 id) {
        if (_merchants[id].owner != msg.sender) revert NotMerchantOwner();
        _;
    }

    modifier onlyAttestor() {
        if (!isAttestor[msg.sender] && msg.sender != owner()) revert NotAttestor();
        _;
    }

    // ───────────────────────────── registration ─────────────────────────────

    /// @notice Direct registration by an owner that has WBT for gas.
    function register(address payout, uint16 maxFeeBps, bytes32 metadataHash, string calldata metadataURI)
        external
        returns (bytes32)
    {
        return _register(msg.sender, payout, maxFeeBps, metadataHash, metadataURI);
    }

    /// @notice Gasless registration: the owner signs, anyone (our relayer) submits.
    function registerWithSig(RegisterMerchant calldata m, bytes calldata sig) external returns (bytes32) {
        if (block.timestamp > m.deadline) revert SignatureExpired();
        if (m.nonce != ownerNonces[m.owner]) revert InvalidNonce();
        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_TYPEHASH,
                m.owner,
                m.payout,
                m.maxFeeBps,
                m.metadataHash,
                keccak256(bytes(m.metadataURI)),
                m.nonce,
                m.deadline
            )
        );
        if (!SignatureChecker.isValidSignatureNow(m.owner, _hashTypedDataV4(structHash), sig)) {
            revert InvalidSignature();
        }
        return _register(m.owner, m.payout, m.maxFeeBps, m.metadataHash, m.metadataURI);
    }

    /// @notice merchantId the next registration by `owner_` will get.
    function predictMerchantId(address owner_) external view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, owner_, ownerNonces[owner_]));
    }

    function _register(
        address owner_,
        address payout,
        uint16 maxFeeBps,
        bytes32 metadataHash,
        string calldata metadataURI
    ) internal returns (bytes32 id) {
        if (owner_ == address(0) || payout == address(0)) revert InvalidAddress();
        if (maxFeeBps > BPS) revert InvalidFeeBps();
        uint256 n = ownerNonces[owner_]++;
        id = keccak256(abi.encode(block.chainid, owner_, n));
        if (_merchants[id].owner != address(0)) revert MerchantExists();
        _merchants[id] = Merchant({
            owner: owner_,
            payout: payout,
            maxFeeBps: maxFeeBps,
            status: STATUS_ACTIVE,
            createdAt: uint64(block.timestamp),
            metadataHash: metadataHash,
            metadataURI: metadataURI
        });
        emit MerchantRegistered(id, owner_, payout, maxFeeBps, metadataHash, metadataURI);
    }

    // ───────────────────────────── quote signers ─────────────────────────────

    function setSigner(bytes32 id, address signer, uint64 expiresAt, bool enabled) external onlyMerchantOwner(id) {
        _setSigner(id, signer, expiresAt, enabled);
    }

    function setSignerWithSig(SetSigner calldata s, bytes calldata sig) external {
        bytes32 structHash = keccak256(
            abi.encode(SET_SIGNER_TYPEHASH, s.merchantId, s.signer, s.expiresAt, s.enabled, s.nonce, s.deadline)
        );
        _useOwnerSig(s.merchantId, structHash, s.nonce, s.deadline, sig);
        _setSigner(s.merchantId, s.signer, s.expiresAt, s.enabled);
    }

    function _setSigner(bytes32 id, address signer, uint64 expiresAt, bool enabled) internal {
        if (signer == address(0)) revert InvalidAddress();
        signers[id][signer] = SignerInfo({expiresAt: expiresAt, enabled: enabled});
        emit SignerSet(id, signer, expiresAt, enabled);
    }

    // ───────────────────────────── payout ─────────────────────────────

    function queuePayoutChange(bytes32 id, address newPayout) external onlyMerchantOwner(id) {
        _queuePayout(id, newPayout);
    }

    function queuePayoutChangeWithSig(QueuePayout calldata q, bytes calldata sig) external {
        bytes32 structHash =
            keccak256(abi.encode(QUEUE_PAYOUT_TYPEHASH, q.merchantId, q.newPayout, q.nonce, q.deadline));
        _useOwnerSig(q.merchantId, structHash, q.nonce, q.deadline, sig);
        _queuePayout(q.merchantId, q.newPayout);
    }

    function _queuePayout(bytes32 id, address newPayout) internal {
        if (newPayout == address(0)) revert InvalidAddress();
        uint64 at = uint64(block.timestamp) + payoutChangeDelay;
        pendingPayout[id] = PendingPayout({newPayout: newPayout, executableAt: at});
        emit PayoutChangeQueued(id, newPayout, at);
    }

    /// @notice Anyone can execute a queued payout change once the delay has passed.
    function executePayoutChange(bytes32 id) external {
        PendingPayout memory p = pendingPayout[id];
        if (p.newPayout == address(0)) revert NoPendingPayout();
        if (block.timestamp < p.executableAt) revert PayoutChangeNotReady();
        Merchant storage m = _merchants[id];
        address old = m.payout;
        m.payout = p.newPayout;
        delete pendingPayout[id];
        emit PayoutChanged(id, old, p.newPayout);
    }

    // ───────────────────────────── splits ─────────────────────────────

    function setSplitProfile(bytes32 id, uint32 profileId, address[] calldata recipients, uint16[] calldata bps)
        external
        onlyMerchantOwner(id)
    {
        _setSplit(id, profileId, recipients, bps);
    }

    function setSplitProfileWithSig(SetSplitRequest calldata s, bytes calldata sig) external {
        bytes32 splitHash = keccak256(abi.encode(s.recipients, s.bps));
        bytes32 structHash =
            keccak256(abi.encode(SET_SPLIT_TYPEHASH, s.merchantId, s.profileId, splitHash, s.nonce, s.deadline));
        _useOwnerSig(s.merchantId, structHash, s.nonce, s.deadline, sig);
        _setSplit(s.merchantId, s.profileId, s.recipients, s.bps);
    }

    function _setSplit(bytes32 id, uint32 profileId, address[] calldata recipients, uint16[] calldata bps) internal {
        uint256 n = recipients.length;
        if (profileId == 0 || n == 0 || n > MAX_SPLIT_RECIPIENTS || n != bps.length) revert InvalidSplit();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (recipients[i] == address(0)) revert InvalidSplit();
            sum += bps[i];
        }
        if (sum != BPS) revert InvalidSplit();
        SplitProfile storage sp = _splits[id][profileId];
        sp.recipients = recipients;
        sp.bps = bps;
        sp.active = true;
        emit SplitProfileSet(id, profileId, recipients, bps);
    }

    // ───────────────────────────── metadata & fee cap ─────────────────────────────

    function setMetadata(bytes32 id, bytes32 metadataHash, string calldata metadataURI)
        external
        onlyMerchantOwner(id)
    {
        _setMetadata(id, metadataHash, metadataURI);
    }

    function setMetadataWithSig(SetMetadata calldata s, bytes calldata sig) external {
        bytes32 structHash = keccak256(
            abi.encode(
                SET_METADATA_TYPEHASH, s.merchantId, s.metadataHash, keccak256(bytes(s.metadataURI)), s.nonce, s.deadline
            )
        );
        _useOwnerSig(s.merchantId, structHash, s.nonce, s.deadline, sig);
        _setMetadata(s.merchantId, s.metadataHash, s.metadataURI);
    }

    function _setMetadata(bytes32 id, bytes32 metadataHash, string calldata metadataURI) internal {
        Merchant storage m = _merchants[id];
        m.metadataHash = metadataHash;
        m.metadataURI = metadataURI;
        emit MetadataUpdated(id, metadataHash, metadataURI);
    }

    function setMaxFeeBps(bytes32 id, uint16 maxFeeBps) external onlyMerchantOwner(id) {
        if (maxFeeBps > BPS) revert InvalidFeeBps();
        _merchants[id].maxFeeBps = maxFeeBps;
        emit MaxFeeBpsSet(id, maxFeeBps);
    }

    // ───────────────────────────── merchant ownership ─────────────────────────────

    function transferMerchantOwnership(bytes32 id, address newOwner) external onlyMerchantOwner(id) {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingMerchantOwner[id] = newOwner;
        emit MerchantOwnershipTransferStarted(id, newOwner);
    }

    function acceptMerchantOwnership(bytes32 id) external {
        if (pendingMerchantOwner[id] != msg.sender) revert NotPendingOwner();
        Merchant storage m = _merchants[id];
        address old = m.owner;
        m.owner = msg.sender;
        delete pendingMerchantOwner[id];
        emit MerchantOwnershipTransferred(id, old, msg.sender);
    }

    // ───────────────────────────── platform: domains, status ─────────────────────────────

    /// @notice Called by the verifier after an offchain DNS / .well-known check.
    function attestDomain(bytes32 id, bytes32 domainHash, uint64 expiresAt) external onlyAttestor {
        if (_merchants[id].owner == address(0)) revert UnknownMerchant();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        domains[id][domainHash] =
            DomainAttestation({verifiedAt: uint64(block.timestamp), expiresAt: expiresAt, attestor: msg.sender});
        emit DomainAttested(id, domainHash, expiresAt, msg.sender);
    }

    /// @notice The platform (attestor/admin) or the merchant owner may revoke.
    function revokeDomain(bytes32 id, bytes32 domainHash) external {
        if (!isAttestor[msg.sender] && msg.sender != owner() && msg.sender != _merchants[id].owner) {
            revert NotAttestor();
        }
        delete domains[id][domainHash];
        emit DomainRevoked(id, domainHash);
    }

    /// @notice Suspension blocks new payments only; refunds and plan cancellations keep working.
    function setStatus(bytes32 id, uint8 status) external onlyOwner {
        if (_merchants[id].owner == address(0)) revert UnknownMerchant();
        if (status != STATUS_ACTIVE && status != STATUS_SUSPENDED) revert InvalidStatus();
        _merchants[id].status = status;
        emit MerchantStatusChanged(id, status);
    }

    function setAttestor(address attestor, bool enabled) external onlyOwner {
        isAttestor[attestor] = enabled;
        emit AttestorSet(attestor, enabled);
    }

    function setPayoutChangeDelay(uint64 delay) external onlyOwner {
        payoutChangeDelay = delay;
        emit PayoutChangeDelaySet(delay);
    }

    // ───────────────────────────── internal sig helper ─────────────────────────────

    function _useOwnerSig(bytes32 id, bytes32 structHash, uint256 nonce, uint64 deadline, bytes calldata sig)
        internal
    {
        address owner_ = _merchants[id].owner;
        if (owner_ == address(0)) revert UnknownMerchant();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (nonce != ownerNonces[owner_]) revert InvalidNonce();
        ownerNonces[owner_] = nonce + 1;
        if (!SignatureChecker.isValidSignatureNow(owner_, _hashTypedDataV4(structHash), sig)) {
            revert InvalidSignature();
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    function getMerchant(bytes32 id) external view returns (Merchant memory) {
        return _merchants[id];
    }

    function isActive(bytes32 id) external view returns (bool) {
        return _merchants[id].status == STATUS_ACTIVE;
    }

    function isSigner(bytes32 id, address s) public view returns (bool) {
        SignerInfo memory info = signers[id][s];
        return info.enabled && (info.expiresAt == 0 || info.expiresAt > block.timestamp);
    }

    function isAuthorized(bytes32 id, address account) external view returns (bool) {
        if (account == address(0)) return false;
        return account == _merchants[id].owner || isSigner(id, account);
    }

    function merchantOwner(bytes32 id) external view returns (address) {
        return _merchants[id].owner;
    }

    function maxFeeBpsOf(bytes32 id) external view returns (uint16) {
        return _merchants[id].maxFeeBps;
    }

    function getSplit(bytes32 id, uint32 profileId)
        external
        view
        returns (address[] memory recipients, uint16[] memory bps)
    {
        if (profileId == 0) {
            address payout = _merchants[id].payout;
            if (payout == address(0)) revert UnknownMerchant();
            recipients = new address[](1);
            bps = new uint16[](1);
            recipients[0] = payout;
            bps[0] = BPS;
            return (recipients, bps);
        }
        SplitProfile storage sp = _splits[id][profileId];
        if (!sp.active) revert InvalidSplit();
        return (sp.recipients, sp.bps);
    }

    function isDomainVerified(bytes32 id, bytes32 domainHash) external view returns (bool) {
        return domains[id][domainHash].expiresAt > block.timestamp;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
