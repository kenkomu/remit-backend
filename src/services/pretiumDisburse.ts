import axios from 'axios';

const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const PRETIUM_CHAIN = 'BASE';
const CALLBACK_URL = `${process.env.WEBHOOK_BASE_URL}/webhooks/pretium`;

if (!PRETIUM_BASE_URL) {
  throw new Error('PRETIUM_API_URL is not set');
}

if (!PRETIUM_API_KEY) {
  throw new Error('PRETIUM_API_KEY is not set');
}

if (!process.env.WEBHOOK_BASE_URL) {
  throw new Error('WEBHOOK_BASE_URL is not set');
}

interface DisburseKesParams {
  phone: string;
  amountKes: number;
  transactionHash: string;
}

interface PretiumDisburseResponse {
  status: string;
  transaction_code: string;
  message: string;
}

export async function disburseKes({
  phone,
  amountKes,
  transactionHash,
}: DisburseKesParams): Promise<PretiumDisburseResponse> {
  const response = await axios.post(
    `${PRETIUM_BASE_URL}/v1/pay/KES`,
    {
      type: 'MOBILE',
      shortcode: phone,
      amount: amountKes,
      fee: 10,
      mobile_network: 'Safaricom',
      chain: PRETIUM_CHAIN,
      transaction_hash: transactionHash,
      callback_url: CALLBACK_URL,
    },
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
    throw new Error(data?.message || 'Pretium disburse failed');
  }

  return data.data;
}
