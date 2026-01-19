// src/routes/paymentRequests.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';
import { sendBaseUsdcTransaction } from '../services/onchainService';
import { pool } from '../services/database';
import { createPaymentRequestWithDailyLimit } from '../services/dailySpendService';

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

const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;

export async function paymentRequestRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Body: CreatePaymentRequestBody;
  }>(
    '/payment-requests',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const body = request.body;

      // 1️⃣ Validate
      const required = [
        body.escrowId,
        body.categoryId,
        body.amountKesCents,
        body.amountUsdCents,
        body.exchangeRate,
        body.merchantName,
        body.merchantAccount,
      ];

      if (required.some(v => !v)) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      // 2️⃣ Create payment request (DB FIRST)
      const paymentRequest = await createPaymentRequestWithDailyLimit({
        recipientId: request.user.userId,
        ...body,
      });

      const paymentRequestId = paymentRequest.paymentRequestId;

      // 3️⃣ Fetch Pretium settlement wallet
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

      const baseNetwork = accountRes.data.data.networks.find(
        (n: any) => n.name.toLowerCase() === 'base'
      );

      if (!baseNetwork?.settlement_wallet_address) {
        throw new Error('BASE settlement wallet not found');
      }

      const settlementWallet = baseNetwork.settlement_wallet_address;

      // 4️⃣ Send USDC (IRREVERSIBLE)
      const amountUsd = body.amountUsdCents / 100;

      const txHash = await sendBaseUsdcTransaction({
        toAddress: settlementWallet,
        amountUsd,
      });

      fastify.log.info(
        { txHash, paymentRequestId },
        'USDC transfer broadcast'
      );

      // 5️⃣ Persist tx hash
      await pool.query(
        `
        UPDATE payment_requests
        SET
          onchain_transaction_hash = $1,
          onchain_status = 'broadcasted',
          status = 'pending_approval'
        WHERE payment_request_id = $2
        `,
        [txHash, paymentRequestId]
      );

      return reply.status(201).send({
        success: true,
        paymentRequestId,
        transactionHash: txHash,
      });
    }
  );
}
