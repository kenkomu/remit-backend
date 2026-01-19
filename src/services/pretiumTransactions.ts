import axios from 'axios';

const PRETIUM_API_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;

interface Transaction {
  id: number;
  transaction_code: string;
  status: string;
  amount: string;
  amount_in_usd: string;
  type: string;
  shortcode: string | null;
  account_number: string | null;
  public_name: string | null;
  receipt_number: string | null;
  category: string;
  chain: string;
  asset: string;
  transaction_hash: string;
  message: string;
  currency_code: string;
  is_released: boolean;
  created_at: string;
}

interface TransactionsResponse {
  code: number;
  message: string;
  data: Transaction[];
}

export async function getTransactions(
  currency: string,
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  const res = await axios.post<TransactionsResponse>(
    `${PRETIUM_API_URL}/v1/transactions/${currency}`,
    { start_date: startDate, end_date: endDate },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PRETIUM_API_KEY,
      },
      timeout: 15000,
    }
  );

  if (!res.data || res.data.code !== 200) {
    throw new Error(res.data?.message || 'Failed to fetch transactions');
  }

  return res.data.data;
}
