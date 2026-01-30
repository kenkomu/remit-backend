import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { 
  getEscrowDetails, 
  getUsdcBalance, 
  getEscrowUsdcBalance,
  isPaymentIdUsed 
} from '../services/onchainService.js';
import { ethers } from 'ethers';
import ContractDeploymentService from '../services/contractDeploymentService.js';
import contractEventMonitor, { ContractEventMonitor } from '../services/contractEventMonitor.js';
import { Queue } from 'bullmq';
import { authMiddleware } from '../middleware/auth.js';

// Admin queues
const adminQueue = new Queue('escrow-refund', { 
  connection: { host: '127.0.0.1', port: 6379 } 
});

const deploymentQueue = new Queue('contract-deployment', { 
  connection: { host: '127.0.0.1', port: 6379 } 
});

export async function blockchainRoutes(fastify: FastifyInstance) {

  // =========================
  // GET CONTRACT STATUS
  // =========================
  fastify.get(
    '/status',
    async (request, reply) => {
      try {
        const status = await contractEventMonitor.getMonitoringStatus();
        const contractBalance = await getEscrowUsdcBalance();
        const walletBalance = await getUsdcBalance();

        return {
          success: true,
          data: {
            monitoring: status,
            contract_balance_usd: contractBalance,
            wallet_balance_usdc: walletBalance,
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // GET ESCROW BLOCKCHAIN DETAILS
  // =========================
  fastify.get<{ Params: { id: string } }>(
    '/escrow/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
        // Get database escrow info
        const { rows: escrowRows } = await pool.query(
          `SELECT 
             e.*,
             r.phone_number_encrypted
           FROM escrows e
           JOIN recipients r ON e.recipient_id = r.recipient_id
           WHERE e.escrow_id = $1`,
          [id]
        );

        if (!escrowRows.length) {
          return reply.code(404).send({ error: 'Escrow not found' });
        }

        const escrow = escrowRows[0];
        let blockchainDetails = null;

        // Get blockchain details if contract exists
        if (escrow.blockchain_contract_address) {
          try {
            blockchainDetails = await getEscrowDetails(id);
          } catch (error) {
            console.warn('Failed to get blockchain details:', error);
          }
        }

        return {
          success: true,
          data: {
            database: {
              escrowId: escrow.escrow_id,
              status: escrow.status,
              totalAmountUsd: escrow.total_amount_usd_cents / 100,
              remainingBalanceUsd: escrow.remaining_balance_usd_cents / 100,
              spentUsd: escrow.total_spent_usd_cents / 100,
              contractAddress: escrow.blockchain_contract_address,
              createdAt: escrow.created_at,
              expiresAt: escrow.expires_at,
            },
            blockchain: blockchainDetails ? {
              exists: true,
              isActive: blockchainDetails.isActive,
              isRefunded: blockchainDetails.isRefunded,
              remainingAmountEth: ethers.formatEther(blockchainDetails.remainingAmount),
              releasedAmountEth: ethers.formatEther(blockchainDetails.releasedAmount),
              purpose: blockchainDetails.purpose,
            } : {
              exists: false,
            },
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // VERIFY PAYMENT ID
  // =========================
  fastify.post<{ Body: { paymentId: string } }>(
    '/verify-payment',
    async (request, reply) => {
      const { paymentId } = request.body;

      if (!paymentId) {
        return reply.code(400).send({ error: 'paymentId is required' });
      }

      try {
        const isUsed = await isPaymentIdUsed(paymentId);

        return {
          success: true,
          data: {
            paymentId,
            used: isUsed,
            message: isUsed ? 'Payment ID already used' : 'Payment ID is available',
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // REFUND ESCROW (ADMIN)
  // =========================
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/escrow/:id/refund',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.body;
      const userId = request.user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        // Check if user owns the escrow
        const { rows } = await pool.query(
          'SELECT sender_user_id FROM escrows WHERE escrow_id = $1',
          [id]
        );

        if (!rows.length || rows[0].sender_user_id !== userId) {
          return reply.code(403).send({ error: 'Access denied' });
        }

        // Queue refund job
        await adminQueue.add(
          'refund-escrow',
          {
            escrowId: id,
            reason: reason || 'User requested refund',
            requestedByUserId: userId,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );

        return {
          success: true,
          message: 'Refund queued for processing',
          escrowId: id,
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // DEPLOY NEW CONTRACT (ADMIN)
  // =========================
  fastify.post<{ Body: { 
    backendServiceAddress: string; 
    feeCollectorAddress: string;
    deployerAddress?: string;
  } }>(
    '/deploy-contract',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { backendServiceAddress, feeCollectorAddress, deployerAddress } = request.body;
      const userId = request.user?.userId;

      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!backendServiceAddress || !feeCollectorAddress) {
        return reply.code(400).send({ 
          error: 'backendServiceAddress and feeCollectorAddress are required' 
        });
      }

      try {
        // Queue deployment job
        await deploymentQueue.add(
          'deploy-contract',
          {
            backendServiceAddress,
            feeCollectorAddress,
            deployerAddress: deployerAddress || '0x0000000000000000000000000000000000000000',
            deployedByUserId: userId,
          },
          {
            attempts: 2,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          }
        );

        return {
          success: true,
          message: 'Contract deployment queued',
          parameters: {
            backendServiceAddress,
            feeCollectorAddress,
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // GET CONTRACT EVENTS
  // =========================
  fastify.get<{ Querystring: { 
    eventName?: string; 
    limit?: number; 
    offset?: number;
  } }>(
    '/events',
    async (request, reply) => {
      const { eventName, limit = 50, offset = 0 } = request.query;

      try {
        let query = `
          SELECT 
            event_name,
            tx_hash,
            block_number,
            event_data,
            created_at
          FROM contract_events
        `;

        const params: any[] = [];
        const conditions: string[] = [];

        if (eventName) {
          conditions.push('event_name = $' + (params.length + 1));
          params.push(eventName);
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
          ORDER BY block_number DESC, created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        params.push(limit, offset);

        const { rows } = await pool.query(query, params);

        return {
          success: true,
          data: {
            events: rows.map(row => ({
              ...row,
              event_data: JSON.parse(row.event_data || '{}'),
            })),
            pagination: {
              limit,
              offset,
              total: rows.length,
            },
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // =========================
  // GET TRANSACTION HISTORY
  // =========================
  fastify.get<{ Params: { escrowId?: string } }>(
    '/transactions/:escrowId?',
    async (request, reply) => {
      const { escrowId } = request.params;

      try {
        let query = `
          SELECT 
            bt.*,
            u.privy_user_id as requested_by,
            pr.payment_request_id
          FROM blockchain_transactions bt
          LEFT JOIN users u ON bt.requested_by_user_id = u.user_id
          LEFT JOIN payment_requests pr ON bt.payment_request_id = pr.payment_request_id
        `;

        const params: any[] = [];

        if (escrowId) {
          query += ' WHERE bt.escrow_id = $1';
          params.push(escrowId);
        }

        query += ' ORDER BY bt.created_at DESC LIMIT 100';

        const { rows } = await pool.query(query, params);

        return {
          success: true,
          data: {
            transactions: rows,
            count: rows.length,
          },
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
