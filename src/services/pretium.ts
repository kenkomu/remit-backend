const PRETIUM_API_URL = 'https://api.xwift.africa';
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const SETTLEMENT_WALLET = process.env.BACKEND_SETTLEMENT_WALLET!;
const WEBHOOK_URL = `${process.env.WEBHOOK_BASE_URL}/webhooks/pretium`;

interface PretiumResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface ExchangeRateData {
  quoted_rate: number | string;
}

interface OnRampData {
  transaction_code: string;
  status: string;
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

  // ✅ Cast the JSON result so it's not 'unknown'
  const json = (await res.json()) as {
    code: number;
    message?: string;
    data?: {
      quoted_rate?: number | string;
      selling_rate?: number | string;
      buying_rate?: number | string;
    };
  };

  if (!res.ok || json.code !== 200 || !json.data) {
    throw new Error(`Exchange rate failed: ${JSON.stringify(json)}`);
  }

  const rate =
    Number(json.data.quoted_rate) ||
    Number(json.data.selling_rate) ||
    Number(json.data.buying_rate);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid exchange rate data: ${JSON.stringify(json.data)}`);
  }

  return rate;
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
      shortcode: params.phone,
      amount: params.amountKes,
      fee: 10,
      mobile_network: 'Safaricom',
      chain: 'BASE',
      asset: 'USDC',
      address: SETTLEMENT_WALLET,
      callback_url: WEBHOOK_URL,
    }),
  });

  // ✅ Cast the JSON result
  const json = (await res.json()) as PretiumResponse<OnRampData>;

  if (!res.ok || json.code !== 200) {
    throw new Error(json.message || 'Pretium onramp failed');
  }

  return json.data;
}
