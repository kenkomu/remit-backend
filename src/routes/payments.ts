import { FastifyInstance } from 'fastify';
import { pool } from '../services/database';
import { createPaymentRequestWithDailyLimit } from '../services/dailySpendService';
import type {
  CreatePaymentRequestRequest,
  CreatePaymentRequestResponse
} from '../types/index.js';

export async function paymentRoutes(fastify: FastifyInstance) {
  // Create payment request
  fastify.post<{ Body: CreatePaymentRequestRequest }>(
    '/',
    async (request, reply) => {
      const { escrowId, category, amountKes, merchantName, merchantAccount } = request.body;

      // Get recipientId from header (mock auth)
      const recipientId = request.headers['x-user-id'] as string;

      if (!recipientId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!escrowId || !category || !amountKes || !merchantName || !merchantAccount) {
        return reply.code(400).send({ 
          error: 'escrowId, category, amountKes, merchantName, and merchantAccount are required' 
        });
      }

      try {
        // Convert KES to cents
        const amountKesCents = Math.round(amountKes * 100);

        // Get exchange rate
        const exchangeRate = 150.0; // 1 USD = 150 KES
        const amountUsdCents = Math.round(amountKesCents / exchangeRate);

        // Get category_id
        const categoryResult = await pool.query(
          `SELECT category_id FROM spending_categories
           WHERE escrow_id = $1 AND category_name = $2`,
          [escrowId, category]
        );

        if (categoryResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Category not found' });
        }

        const categoryId = categoryResult.rows[0].category_id;

        // Create payment request with daily limit enforcement
        const result = await createPaymentRequestWithDailyLimit({
          recipientId,
          escrowId,
          categoryId,
          amountKesCents,
          amountUsdCents,
          exchangeRate,
          merchantName,
          merchantAccount
        });

        return reply.code(201).send({
          paymentRequestId: result.paymentRequestId,
          status: 'pending_approval',
          amountKes
        });
        
      } catch (error: any) {
        fastify.log.error(error);

        // Daily limit exceeded
        if (error.message.includes('Daily limit exceeded')) {
          return reply.code(429).send({
            error: 'Daily spending limit exceeded',
            message: error.message
          });
        }

        return reply.code(400).send({ error: error.message });
      }
    }
  );

  // Get payment request by ID
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;
      
      try {
        const result = await pool.query(
          `SELECT payment_request_id, status, amount_kes_cents, created_at
           FROM payment_requests
           WHERE payment_request_id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Payment request not found' });
        }

        const pr = result.rows[0];

        return {
          paymentRequestId: pr.payment_request_id,
          status: pr.status,
          amountKes: Number(pr.amount_kes_cents) / 100,
          createdAt: pr.created_at
        };
        
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}