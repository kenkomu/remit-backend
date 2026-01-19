import { FastifyInstance, FastifyRequest, FastifyReply, RouteGenericInterface } from 'fastify';
import {
  createPaymentRequestWithDailyLimit,
  getDailySpendStatus,
} from '../services/dailySpendService';
import axios from 'axios';
import { sendBaseUsdcTransaction } from '../services/onchainService'; // your on-chain send logic
import { pool } from '../services/database';

// Request body type
interface CreatePaymentRequestBody {
  escrowId: string;
  categoryId: string;
  amountKesCents: number;
  amountUsdCents: number;
  exchangeRate: number;
  merchantName: string;
  merchantAccount: string;
  invoiceUrl?: string;
  invoiceHash?: string;
}

// Proper RouteGenericInterface
interface CreatePaymentRequestRoute extends RouteGenericInterface {
  Body: CreatePaymentRequestBody;
}

// Pretium config
const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const PRETIUM_CHAIN = 'BASE';

export async function paymentRequestRoutes(fastify: FastifyInstance) {
  /**
   * Create payment request with daily spend enforcement and automatic deposit
   */
  fastify.post(
    '/payment-requests',
    {
      preHandler: async (request, reply) => {
        await fastify.authenticate(request, reply);
      },
    },
    async (request: FastifyRequest<CreatePaymentRequestRoute>, reply: FastifyReply) => {
      const {
        escrowId,
        categoryId,
        amountKesCents,
        amountUsdCents,
        exchangeRate,
        merchantName,
        merchantAccount,
        invoiceUrl,
        invoiceHash,
      } = request.body;

      if (!escrowId || !categoryId || !amountKesCents || !amountUsdCents || !exchangeRate || !merchantName || !merchantAccount) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // 1️⃣ Create the payment request
        const paymentRequest = await createPaymentRequestWithDailyLimit({
          recipientId: request.user.userId,
          escrowId,
          categoryId,
          amountKesCents,
          amountUsdCents,
          exchangeRate,
          merchantName,
          merchantAccount,
          invoiceUrl,
          invoiceHash,
        });

        const paymentRequestId = paymentRequest.paymentRequestId;

        // 2️⃣ Get Pretium settlement wallet for BASE
        const accountRes = await axios.post(
          `${PRETIUM_BASE_URL}/account/detail`,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': PRETIUM_API_KEY,
            },
          }
        );

        if (accountRes.data.code !== 200) {
          throw new Error('Failed to fetch Pretium account details');
        }

        const baseNetwork = accountRes.data.data.networks.find((n: any) => n.name.toLowerCase() === 'base');
        if (!baseNetwork || !baseNetwork.settlement_wallet_address) {
          throw new Error('BASE settlement wallet not found in Pretium account');
        }

        const settlementWallet = baseNetwork.settlement_wallet_address;

        // 3️⃣ Send BASE USDC on-chain
        // Use the amountUsdCents provided in the request body
        const amountUsd = amountUsdCents / 100;

        const transactionHash = await sendBaseUsdcTransaction({
          toAddress: settlementWallet,
          amountUsd, // USDC amount
          chain: PRETIUM_CHAIN,
        });

        if (!transactionHash) {
          throw new Error('Failed to get transaction hash from on-chain deposit');
        }

        // 4️⃣ Update payment request with transaction hash
        await client.query(
          `
          UPDATE payment_requests
          SET onchain_transaction_hash = $1, status = 'pending_approval'
          WHERE payment_request_id = $2
          `,
          [transactionHash, paymentRequestId]
        );

        await client.query('COMMIT');

        return reply.status(201).send({
          success: true,
          paymentRequestId,
          transactionHash,
          message: 'Payment request created and deposit initiated successfully',
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error({ err: error }, 'Payment request creation error');
        return reply.status(500).send({ error: error.message || 'Internal server error' });
      } finally {
        client.release();
      }
    }
  );

  /**
   * Get daily spend status
   */
  fastify.get(
    '/daily-spend/status',
    {
      preHandler: async (request, reply) => {
        await fastify.authenticate(request, reply);
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const status = await getDailySpendStatus(request.user.userId);

        return reply.send({
          dailyLimit: status.dailyLimitCents / 100,
          spentToday: status.spentTodayCents / 100,
          remainingToday: status.remainingTodayCents / 100,
          transactionCount: status.transactionCount,
          lastTransactionAt: status.lastTransactionAt,
          limitReached: status.remainingTodayCents === 0,
        });
      } catch (error) {
        fastify.log.error({ err: error }, 'Daily spend status error');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}
