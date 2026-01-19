// src/services/onchainService.ts
import { ethers } from 'ethers';

const BASE_RPC_URL = process.env.BASE_RPC_URL!;
const BASE_USDC_CONTRACT = process.env.BASE_USDC_CONTRACT!;
const PRIVATE_KEY = process.env.BASE_PRIVATE_KEY!;

if (!BASE_RPC_URL) throw new Error('BASE_RPC_URL is not set');
if (!BASE_USDC_CONTRACT) throw new Error('BASE_USDC_CONTRACT is not set');
if (!PRIVATE_KEY) throw new Error('BASE_PRIVATE_KEY is not set');

interface SendBaseUsdcParams {
  toAddress: string;
  amountUsd: number;
}

export async function sendBaseUsdcTransaction({
  toAddress,
  amountUsd,
}: SendBaseUsdcParams): Promise<string> {
  if (!ethers.isAddress(toAddress)) {
    throw new Error('Invalid recipient address');
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const erc20Abi = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
  ];

  const usdc = new ethers.Contract(BASE_USDC_CONTRACT, erc20Abi, wallet);

  const decimals = await usdc.decimals();
  const amount = ethers.parseUnits(amountUsd.toFixed(6), decimals);

  const tx = await usdc.transfer(toAddress, amount);

  // 🚨 DO NOT wait
  return tx.hash;
}
