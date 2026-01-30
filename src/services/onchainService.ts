import { ethers } from 'ethers';
import fs from 'fs';

// Load ABI at runtime to avoid JSON import issues in ESM
const ESCROW_ARTIFACT_PATH = new URL('../blockchain/SimpleEscrow.json', import.meta.url);
const SimpleEscrowAbi: { abi: any } = JSON.parse(
  fs.readFileSync(ESCROW_ARTIFACT_PATH, 'utf-8')
);

const BASE_RPC_URL = process.env.BASE_RPC_URL!;
const BASE_USDC_CONTRACT = process.env.BASE_USDC_CONTRACT!;
const PRIVATE_KEY = process.env.BASE_PRIVATE_KEY!;
const SIMPLE_ESCROW_ADDRESS = process.env.SIMPLE_ESCROW_ADDRESS!;

interface SendBaseUsdcParams {
  toAddress: string;
  amountUsd: number;
}

interface BuildCreateEscrowTxParams {
  escrowId: string;
  beneficiary: string;
  amountUsdc: number; // deposit amount in USDC
  durationDays: number;
}

interface CreateEscrowWithUsdcParams extends BuildCreateEscrowTxParams {}

interface ConfirmPaymentParams {
  escrowId: string;
  paymentId: string;
  amountUsdc: number; // release amount in USDC
}

interface RefundEscrowParams {
  escrowId: string;
  reason: string;
}

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// USDC Contract (for balance checks)
const erc20Abi = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const usdcContract = new ethers.Contract(BASE_USDC_CONTRACT, erc20Abi, wallet);

// SimpleEscrow Contract (ETH-based, using actual deployed contract)
const escrowContract = new ethers.Contract(
  SIMPLE_ESCROW_ADDRESS,
  SimpleEscrowAbi.abi,
  wallet
);

export async function sendBaseUsdcTransaction({
  toAddress,
  amountUsd,
}: SendBaseUsdcParams): Promise<string> {
  if (!ethers.isAddress(toAddress)) {
    throw new Error('Invalid recipient address');
  }

  const decimals = await usdcContract.decimals();
  const amount = ethers.parseUnits(amountUsd.toFixed(6), decimals);

  const balance = await usdcContract.balanceOf(wallet.address);
  if (balance < amount) {
    throw new Error('Insufficient USDC balance for transfer');
  }

  const tx = await usdcContract.transfer(toAddress, amount);
  return tx.hash;
}

// Build transaction data for client wallets to create escrow (ETH-based)
export function buildCreateEscrowTxData({
  escrowId,
  beneficiary,
  amountUsdc,
  durationDays,
}: BuildCreateEscrowTxParams): { to: string; data: string; value: string } {
  if (!ethers.isAddress(beneficiary)) {
    throw new Error('Invalid beneficiary address');
  }
  
  // Convert string escrowId to bytes32
  const escrowIdBytes32 = ethers.id(escrowId);
  
  // Convert USDC amount to ETH equivalent (for demo purposes, using 1:1 conversion)
  const amountEth = amountUsdc / 1000; // Example: 1 USDC = 0.001 ETH for testing
  const amount = ethers.parseEther(amountEth.toString());
  
  const data = escrowContract.interface.encodeFunctionData('createEscrow', [
    escrowIdBytes32,
    beneficiary,
    'Payment purpose', // Default purpose
    durationDays,
  ]);
  
  return { 
    to: SIMPLE_ESCROW_ADDRESS, 
    data, 
    value: amount.toString() // ETH value to send
  };
}

// Backend-executed create (ETH-based escrow, adapted for USDC interface)
export async function createEscrowWithUsdc({
  escrowId,
  beneficiary,
  amountUsdc,
  durationDays,
}: CreateEscrowWithUsdcParams): Promise<{ txHash: string; blockchainEscrowId: string }> {
  if (!ethers.isAddress(beneficiary)) {
    throw new Error('Invalid beneficiary address');
  }
  
  // Convert string escrowId to bytes32
  const escrowIdBytes32 = ethers.id(escrowId);
  
  // Convert USDC amount to ETH equivalent (for demo purposes)
  const amountEth = amountUsdc / 1000; // Example conversion
  const amount = ethers.parseEther(amountEth.toString());
  
  // Check ETH balance
  const balance = await provider.getBalance(wallet.address);
  if (balance < amount) {
    throw new Error('Insufficient ETH balance for escrow');
  }
  
  // Create escrow with ETH value (using deployed SimpleEscrow contract)
  const tx = await escrowContract.createEscrow(
    escrowIdBytes32,
    beneficiary,
    'Payment purpose', // Default purpose
    durationDays,
    { value: amount }
  );
  const receipt = await tx.wait();
  
  // The escrowId is the same bytes32 we passed in
  return { txHash: tx.hash, blockchainEscrowId: escrowId };
}

export async function confirmPayment({
  escrowId,
  paymentId,
  amountUsdc,
}: ConfirmPaymentParams): Promise<string> {
  // Convert string IDs to bytes32
  const escrowIdBytes32 = ethers.id(escrowId);
  const paymentIdBytes32 = ethers.id(paymentId);
  
  // Convert USDC amount to ETH equivalent
  const amountEth = amountUsdc / 1000;
  const amount = ethers.parseEther(amountEth.toString());
  
  const tx = await escrowContract.confirmPayment(
    escrowIdBytes32, 
    paymentIdBytes32, 
    amount, 
    'M-Pesa ref' // Default M-Pesa reference
  );

  return tx.hash;
}

export async function refundEscrow({
  escrowId,
  reason,
}: RefundEscrowParams): Promise<string> {
  const escrowIdBytes32 = ethers.id(escrowId);
  const tx = await escrowContract.refundEscrow(escrowIdBytes32, reason);
  return tx.hash;
}

export async function getEscrowDetails(escrowId: string) {
  const escrowIdBytes32 = ethers.id(escrowId);
  const escrow = await escrowContract.getEscrow(escrowIdBytes32);
  return escrow;
}

export async function isPaymentIdUsed(paymentId: string): Promise<boolean> {
  const paymentIdBytes32 = ethers.id(paymentId);
  return await escrowContract.isPaymentIdUsed(paymentIdBytes32);
}

export async function getUsdcBalance(address?: string): Promise<string> {
  const balance = await usdcContract.balanceOf(address || wallet.address);
  const decimals = await usdcContract.decimals();
  return ethers.formatUnits(balance, decimals);
}

export async function getEthBalance(address?: string): Promise<string> {
  const balance = await provider.getBalance(address || wallet.address);
  return ethers.formatEther(balance);
}

export async function getEscrowUsdcBalance(): Promise<string> {
  // For the ETH-based contract, return ETH balance formatted as USDC equivalent
  const ethBalance = await provider.getBalance(SIMPLE_ESCROW_ADDRESS);
  const ethAmount = parseFloat(ethers.formatEther(ethBalance));
  const usdcEquivalent = ethAmount * 1000; // Convert ETH to USDC equivalent
  return usdcEquivalent.toString();
}

// Event listeners for ETH-based escrow (adapted for USDC interface)
export function setupEscrowEventListeners() {
  // EscrowCreated(bytes32 indexed escrowId, address indexed sender, address indexed beneficiary, uint256 amount, string purpose, uint256 expiresAt)
  escrowContract.on('EscrowCreated', (escrowId, sender, beneficiary, amount, purpose, expiresAt) => {
    console.log('EscrowCreated:', {
      escrowId: escrowId, // bytes32
      sender,
      beneficiary,
      amount: ethers.formatEther(amount), // ETH amount
      purpose,
      expiresAt: Number(expiresAt),
    });
  });

  // PaymentConfirmed(bytes32 indexed escrowId, bytes32 indexed paymentId, uint256 amount, string mpesaRef, uint256 remainingAmount)
  escrowContract.on('PaymentConfirmed', (escrowId, paymentId, amount, mpesaRef, remainingAmount) => {
    console.log('PaymentConfirmed:', {
      escrowId: escrowId, // bytes32
      paymentId: paymentId, // bytes32
      amount: ethers.formatEther(amount), // ETH amount
      mpesaRef,
      remainingAmount: ethers.formatEther(remainingAmount), // ETH amount
    });
  });

  // EscrowRefunded(bytes32 indexed escrowId, address indexed sender, uint256 amount, string reason)
  escrowContract.on('EscrowRefunded', (escrowId, sender, amount, reason) => {
    console.log('EscrowRefunded:', {
      escrowId: escrowId, // bytes32
      sender,
      amount: ethers.formatEther(amount), // ETH amount
      reason,
    });
  });
}

// Utility function - SimpleEscrow uses bytes32 escrow IDs
export async function checkEscrowExists(escrowId: string): Promise<boolean> {
  const escrowIdBytes32 = ethers.id(escrowId); // Convert string to bytes32
  return await escrowContract.escrowExists(escrowIdBytes32);
}

// Legacy function for backwards compatibility (simulate USDC functionality)
export async function getNextEscrowId(): Promise<number> {
  // For ETH-based contract, we generate escrow IDs differently
  // Return a mock incremental ID for compatibility
  return Date.now() % 1000000; // Simple mock ID
}