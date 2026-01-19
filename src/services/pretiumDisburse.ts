// src/services/pretiumDisburse.ts
import axios from 'axios';

const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const CALLBACK_URL = `${process.env.WEBHOOK_BASE_URL}/webhooks/pretium`;

if (!PRETIUM_BASE_URL) throw new Error('PRETIUM_API_URL is not set');
if (!PRETIUM_API_KEY) throw new Error('PRETIUM_API_KEY is not set');
if (!process.env.WEBHOOK_BASE_URL) throw new Error('WEBHOOK_BASE_URL is not set');

interface PretiumDisburseResponse {
  status: string;
  transaction_code: string;
  message: string;
}

export async function disburseKes(): Promise<PretiumDisburseResponse> {
  // ✅ Payload exactly as you provided
  const payload = {
    type: "MOBILE",
    shortcode: "0112285105",
    amount: 28,
    fee: 10,
    mobile_network: "Safaricom",
    chain: "BASE",
    transaction_hash: "0x03f6be9d63eb2ce36fd77a403a17ec3c80d7ad0457c7f24126350f6fe6943e1e",
    callback_url: "https://531ef8fe65fa.ngrok-free.app/webhooks/pretium"
  };

  try {
    const response = await axios.post(
      `${PRETIUM_BASE_URL}/v1/pay/KES`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': PRETIUM_API_KEY,
        },
        timeout: 15000,
      }
    );

    const data = response.data;

    if (!data || data.code !== 200) {
      throw new Error(data?.message || `Pretium disburse failed: ${JSON.stringify(data)}`);
    }

    console.log('Pretium Response:', data);
    return data.data;
  } catch (err: any) {
    console.error('Disburse failed:', err.response?.data || err.message);
    throw err;
  }
}

// Example usage
disburseKes()
  .then(res => console.log('Disbursement initiated:', res))
  .catch(err => console.error('Error:', err.message));
