// /services/onchainService.ts
import { ethers } from 'ethers';

// Load env variables
const BASE_RPC_URL = process.env.BASE_RPC_URL!;
const BASE_USDC_CONTRACT = process.env.BASE_USDC_CONTRACT!; // USDC contract address on BASE
const PRIVATE_KEY = process.env.BASE_PRIVATE_KEY!; // Your backend wallet private key

if (!BASE_RPC_URL) throw new Error('BASE_RPC_URL is not set');
if (!BASE_USDC_CONTRACT) throw new Error('BASE_USDC_CONTRACT is not set');
if (!PRIVATE_KEY) throw new Error('BASE_PRIVATE_KEY is not set');

/**
 * Send BASE USDC from backend wallet to a recipient
 */
interface SendBaseUsdcParams {
  toAddress: string;
  amountUsd: number; // USDC amount (not in wei)
  chain?: string; // optional, default BASE
}

export async function sendBaseUsdcTransaction({
  toAddress,
  amountUsd,
  chain = 'BASE',
}: SendBaseUsdcParams): Promise<string> {
  // ✅ ethers v6 uses isAddress directly
  if (!ethers.isAddress(toAddress)) {
    throw new Error('Invalid recipient address');
  }

  // Connect to BASE RPC
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);

  // Wallet with backend private key
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // USDC contract ABI (ERC20 minimal)
  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
  ];

  const usdcContract = new ethers.Contract(BASE_USDC_CONTRACT, erc20Abi, wallet);

  // Get USDC decimals
  const decimals: number = await usdcContract.decimals();

  // ✅ Round to 6 decimal places to avoid floating point issues
  const amountFixed = Number(amountUsd.toFixed(6));

  // ✅ ethers v6 uses parseUnits directly
  const amount = ethers.parseUnits(amountFixed.toString(), decimals);

  // Send transaction
  const tx = await usdcContract.transfer(toAddress, amount);

  // Wait for confirmation
  const receipt = await tx.wait(1); // wait for 1 block confirmation

  if (!receipt || receipt.status !== 1) {
    throw new Error('Transaction failed on-chain');
  }

  return receipt.transactionHash;
}
