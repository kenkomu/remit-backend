import { v4 as uuidv4 } from 'uuid';
import type {
  CreateEscrowResponse,
  GetEscrowResponse,
  CreatePaymentRequestResponse,
  GetPaymentRequestResponse
} from '../types/index.js';

export function generateMockEscrow(totalAmountUsd: number, categories: string[]): CreateEscrowResponse {
  return {
    escrowId: uuidv4(),
    status: 'active',
    totalAmountUsd
  };
}

export function generateMockEscrowDetails(escrowId: string): GetEscrowResponse {
  const categories = ['electricity', 'water', 'rent'];
  return {
    escrowId,
    status: 'active',
    spentUsd: 50,
    categories: categories.map(name => ({
      name,
      remainingUsd: Math.floor(Math.random() * 200) + 50
    }))
  };
}

export function generateMockPaymentRequest(): CreatePaymentRequestResponse {
  return {
    paymentRequestId: uuidv4(),
    status: 'pending'
  };
}

export function generateMockPaymentRequestDetails(paymentRequestId: string): GetPaymentRequestResponse {
  return {
    paymentRequestId,
    status: 'pending'
  };
}