export interface SendOTPRequest {
  phone: string;
}

export interface SendOTPResponse {
  success: boolean;
  otpSent: boolean;
}

export interface VerifyOTPRequest {
  phone: string;
  otp: string;
}

export interface VerifyOTPResponse {
  token: string;
  userId: string;
}

export interface CreateEscrowRequest {
  recipientPhone: string;
  totalAmountUsd: number;
  categories: string[];
}

export interface CreateEscrowResponse {
  escrowId: string;
  status: string;
  totalAmountUsd: number;
}

export interface EscrowCategory {
  name: string;
  remainingUsd: number;
}

export interface GetEscrowResponse {
  escrowId: string;
  status: string;
  spentUsd: number;
  categories: EscrowCategory[];
}

export interface CreatePaymentRequestRequest {
  escrowId: string;
  category: string;
  amountKes: number;
}

export interface CreatePaymentRequestResponse {
  paymentRequestId: string;
  status: string;
}

export interface GetPaymentRequestResponse {
  paymentRequestId: string;
  status: string;
}