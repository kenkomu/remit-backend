import { v4 as uuidv4 } from 'uuid';

// Mock Privy configuration
const privyAppId = process.env.PRIVY_APP_ID || 'mock-app-id';
const privyAppSecret = process.env.PRIVY_APP_SECRET || 'mock-secret';

export function initPrivy() {
  console.log('Privy initialized:', {
    appId: privyAppId,
    hasSecret: !!privyAppSecret
  });
}

// Mock OTP sending
export async function sendOTP(phone: string): Promise<{ success: boolean; otpSent: boolean }> {
  console.log(`[MOCK] Sending OTP to ${phone}`);
  // In real implementation, this would call Privy's API
  return {
    success: true,
    otpSent: true
  };
}

// Mock OTP verification
export async function verifyOTP(
  phone: string,
  otp: string
): Promise<{ token: string; phone: string }> {
  console.log(`[MOCK] Verifying OTP for ${phone}: ${otp}`);

  return {
    token: `mock-jwt-token:${phone}`,
    phone
  };
}
