// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SimpleEscrowUSDC
 * @notice USDC-based escrow contract for single-purpose payments (rent, school fees, etc.)
 * @dev Designed for production fintech use case with strict security
 *
 * Features:
 * - Single beneficiary per escrow
 * - Backend-controlled payment confirmation
 * - Replay attack prevention
 * - Automatic expiry with refund
 * - USDC token-based operations
 * - Immutable once created
 *
 * Security:
 * - Only backend can confirm payments
 * - Payment IDs prevent double-spending
 * - Time-locked expiry mechanism
 * - ReentrancyGuard protection
 * - Token transfer safety checks
 */
contract SimpleEscrowUSDC is ReentrancyGuard {
    // =====================================================
    // STATE VARIABLES
    // =====================================================

    /// @notice Contract owner (deployer)
    address public owner;

    /// @notice Backend service address (authorized to confirm payments)
    address public backendService;

    /// @notice Fee collector address (receives protocol fees)
    address public feeCollector;

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /// @notice Protocol fee in basis points (100 = 1%)
    uint256 public protocolFeeBps = 100; // 1% default

    /// @notice Maximum protocol fee (cannot exceed 5%)
    uint256 public constant MAX_FEE_BPS = 500;

    // =====================================================
    // DATA STRUCTURES
    // =====================================================

    struct Escrow {
        bytes32 escrowId; // Unique escrow identifier
        address sender; // Who funded the escrow
        address beneficiary; // Who receives the funds
        uint256 totalAmount; // Total deposited amount (in USDC units, 6 decimals)
        uint256 remainingAmount; // Amount still available
        uint256 releasedAmount; // Amount already released
        string purpose; // e.g., "rent", "school_fees"
        uint256 expiresAt; // Unix timestamp when escrow expires
        bool isActive; // Whether escrow is active
        bool isRefunded; // Whether escrow was refunded
        uint256 createdAt; // Creation timestamp
    }

    // =====================================================
    // STORAGE
    // =====================================================

    /// @notice Mapping of escrow ID to Escrow struct
    mapping(bytes32 => Escrow) public escrows;

    /// @notice Mapping of payment ID to prevent replay attacks
    mapping(bytes32 => bool) public usedPaymentIds;

    /// @notice Mapping to track if an escrow ID exists
    mapping(bytes32 => bool) public escrowExists;

    // =====================================================
    // EVENTS
    // =====================================================

    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed sender,
        address indexed beneficiary,
        uint256 amount,
        string purpose,
        uint256 expiresAt
    );

    event PaymentConfirmed(
        bytes32 indexed escrowId,
        bytes32 indexed paymentId,
        uint256 amount,
        string mpesaRef,
        uint256 remainingAmount
    );

    event EscrowRefunded(
        bytes32 indexed escrowId,
        address indexed sender,
        uint256 amount,
        string reason
    );

    event BackendServiceUpdated(
        address indexed oldBackend,
        address indexed newBackend
    );

    event FeeCollectorUpdated(
        address indexed oldCollector,
        address indexed newCollector
    );

    event ProtocolFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);

    // =====================================================
    // MODIFIERS
    // =====================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyBackend() {
        require(msg.sender == backendService, "Only backend service");
        _;
    }

    modifier escrowMustExist(bytes32 escrowId) {
        require(escrowExists[escrowId], "Escrow does not exist");
        _;
    }

    modifier escrowMustBeActive(bytes32 escrowId) {
        require(escrows[escrowId].isActive, "Escrow not active");
        _;
    }

    // =====================================================
    // CONSTRUCTOR
    // =====================================================

    constructor(
        address _backendService, 
        address _feeCollector, 
        address _usdc
    ) {
        require(_backendService != address(0), "Invalid backend address");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_usdc != address(0), "Invalid USDC address");

        owner = msg.sender;
        backendService = _backendService;
        feeCollector = _feeCollector;
        usdc = IERC20(_usdc);
    }

    // =====================================================
    // CORE FUNCTIONS
    // =====================================================

    /**
     * @notice Create a new escrow with USDC deposit
     * @param escrowId Unique identifier for the escrow
     * @param beneficiary Address of the recipient
     * @param purpose Purpose of the payment (e.g., "rent", "school_fees")
     * @param durationDays Number of days until expiry
     * @param amount Amount of USDC to deposit (in USDC units with 6 decimals)
     */
    function createEscrow(
        bytes32 escrowId,
        address beneficiary,
        string calldata purpose,
        uint256 durationDays,
        uint256 amount
    ) external nonReentrant {
        require(!escrowExists[escrowId], "Escrow already exists");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(amount > 0, "Must deposit funds");
        require(durationDays > 0 && durationDays <= 365, "Invalid duration");
        require(
            bytes(purpose).length > 0 && bytes(purpose).length <= 100,
            "Invalid purpose"
        );

        uint256 expiresAt = block.timestamp + (durationDays * 1 days);

        // Transfer USDC from sender to this contract
        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        escrows[escrowId] = Escrow({
            escrowId: escrowId,
            sender: msg.sender,
            beneficiary: beneficiary,
            totalAmount: amount,
            remainingAmount: amount,
            releasedAmount: 0,
            purpose: purpose,
            expiresAt: expiresAt,
            isActive: true,
            isRefunded: false,
            createdAt: block.timestamp
        });

        escrowExists[escrowId] = true;

        emit EscrowCreated(
            escrowId,
            msg.sender,
            beneficiary,
            amount,
            purpose,
            expiresAt
        );
    }

    /**
     * @notice Confirm a payment and release USDC (BACKEND ONLY)
     * @param escrowId The escrow to release from
     * @param paymentId Unique payment identifier (prevents replay)
     * @param amount Amount to release (in USDC units)
     * @param mpesaRef M-Pesa transaction reference
     */
    function confirmPayment(
        bytes32 escrowId,
        bytes32 paymentId,
        uint256 amount,
        string calldata mpesaRef
    )
        external
        onlyBackend
        escrowMustExist(escrowId)
        escrowMustBeActive(escrowId)
        nonReentrant
    {
        Escrow storage escrow = escrows[escrowId];

        // Validate payment
        require(!usedPaymentIds[paymentId], "Payment ID already used");
        require(amount > 0, "Amount must be positive");
        require(
            escrow.remainingAmount >= amount,
            "Insufficient escrow balance"
        );
        require(block.timestamp < escrow.expiresAt, "Escrow expired");
        require(bytes(mpesaRef).length > 0, "M-Pesa reference required");

        // Mark payment ID as used (prevent replay)
        usedPaymentIds[paymentId] = true;

        // Calculate fee
        uint256 fee = (amount * protocolFeeBps) / 10000;
        uint256 amountAfterFee = amount - fee;

        // Update escrow balances
        escrow.remainingAmount -= amount;
        escrow.releasedAmount += amount;

        // Transfer USDC to beneficiary
        require(
            usdc.transfer(escrow.beneficiary, amountAfterFee),
            "Beneficiary transfer failed"
        );

        // Transfer fee to fee collector
        if (fee > 0) {
            require(
                usdc.transfer(feeCollector, fee),
                "Fee transfer failed"
            );
        }

        // If escrow is fully spent, mark as inactive
        if (escrow.remainingAmount == 0) {
            escrow.isActive = false;
        }

        emit PaymentConfirmed(
            escrowId,
            paymentId,
            amount,
            mpesaRef,
            escrow.remainingAmount
        );
    }

    /**
     * @notice Refund an expired or cancelled escrow
     * @param escrowId The escrow to refund
     * @param reason Reason for refund
     */
    function refundEscrow(
        bytes32 escrowId,
        string calldata reason
    ) external onlyBackend escrowMustExist(escrowId) nonReentrant {
        Escrow storage escrow = escrows[escrowId];

        require(escrow.isActive, "Escrow not active");
        require(!escrow.isRefunded, "Already refunded");
        require(
            block.timestamp >= escrow.expiresAt || bytes(reason).length > 0,
            "Cannot refund before expiry without reason"
        );

        uint256 refundAmount = escrow.remainingAmount;
        require(refundAmount > 0, "No funds to refund");

        // Update state
        escrow.isActive = false;
        escrow.isRefunded = true;
        escrow.remainingAmount = 0;

        // Transfer refund to sender
        require(
            usdc.transfer(escrow.sender, refundAmount),
            "Refund transfer failed"
        );

        emit EscrowRefunded(escrowId, escrow.sender, refundAmount, reason);
    }

    // =====================================================
    // VIEW FUNCTIONS
    // =====================================================

    /**
     * @notice Get full escrow details
     */
    function getEscrow(
        bytes32 escrowId
    ) external view escrowMustExist(escrowId) returns (Escrow memory) {
        return escrows[escrowId];
    }

    /**
     * @notice Check if a payment ID has been used
     */
    function isPaymentIdUsed(bytes32 paymentId) external view returns (bool) {
        return usedPaymentIds[paymentId];
    }

    /**
     * @notice Check if an escrow has expired
     */
    function isExpired(
        bytes32 escrowId
    ) external view escrowMustExist(escrowId) returns (bool) {
        return block.timestamp >= escrows[escrowId].expiresAt;
    }

    /**
     * @notice Get contract's USDC balance
     */
    function getContractBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // =====================================================
    // ADMIN FUNCTIONS
    // =====================================================

    /**
     * @notice Update backend service address
     */
    function setBackendService(address newBackend) external onlyOwner {
        require(newBackend != address(0), "Invalid address");
        address oldBackend = backendService;
        backendService = newBackend;
        emit BackendServiceUpdated(oldBackend, newBackend);
    }

    /**
     * @notice Update fee collector address
     */
    function setFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "Invalid address");
        address oldCollector = feeCollector;
        feeCollector = newCollector;
        emit FeeCollectorUpdated(oldCollector, newCollector);
    }

    /**
     * @notice Update protocol fee
     */
    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFee = protocolFeeBps;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice Emergency withdrawal (only owner)
     * @dev Should only be used in extreme circumstances
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "No USDC to withdraw");
        require(usdc.transfer(owner, balance), "Emergency withdraw failed");
    }

    /**
     * @notice Get USDC token address
     */
    function getUSDCAddress() external view returns (address) {
        return address(usdc);
    }
}