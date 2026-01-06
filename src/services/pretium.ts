const PRETIUM_API_URL = 'https://api.xwift.africa';
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const SETTLEMENT_WALLET = process.env.BACKEND_SETTLEMENT_WALLET!;
const WEBHOOK_URL = `${process.env.WEBHOOK_BASE_URL}/webhooks/pretium`;

// Define a common API response type
interface PretiumResponse<T> {
  code: number;
  message: string;
  data: T;
}

// Exchange rate response type
interface ExchangeRateData {
  quoted_rate: string | number;
}

// Onramp response type
interface OnRampData {
  transaction_id: string;
  status: string;
  amount: number;
  shortcode: string;
  [key: string]: any; // allow extra fields
}

export async function getExchangeRate(): Promise<number> {
  const res = await fetch(`${PRETIUM_API_URL}/v1/exchange-rate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PRETIUM_API_KEY,
    },
    body: JSON.stringify({ currency_code: 'KES' }),
  });

  // ✅ Cast the result of res.json()
  const json = (await res.json()) as PretiumResponse<ExchangeRateData>;

  if (!res.ok || json.code !== 200) {
    throw new Error(json.message || 'Exchange rate failed');
  }

  return Number(json.data.quoted_rate);
}

export async function initiateKesOnRamp(params: {
  phone: string;
  amountKes: number;
}): Promise<OnRampData> {
  const res = await fetch(`${PRETIUM_API_URL}/v1/onramp/KES`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PRETIUM_API_KEY,
    },
    body: JSON.stringify({
      shortcode: params.phone,        // 👈 LOCAL FORMAT ONLY
      amount: params.amountKes,
      fee: 10,                         // 👈 REQUIRED
      mobile_network: 'Safaricom',
      chain: 'BASE',
      asset: 'USDC',
      address: SETTLEMENT_WALLET,
      callback_url: WEBHOOK_URL,
    }),
  });

  // ✅ Cast the result of res.json()
  const json = (await res.json()) as PretiumResponse<OnRampData>;

  if (!res.ok) {
    throw new Error(
      `Pretium error ${res.status}: ${JSON.stringify(json)}`
    );
  }

  if (json.code !== 200) {
    throw new Error(json.message);
  }

  return json.data;
}
