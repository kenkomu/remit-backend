import { FastifyInstance } from 'fastify';
import { generateMockEscrow, generateMockEscrowDetails } from '../utils/fakeData.js';
import type {
  CreateEscrowRequest,
  CreateEscrowResponse,
  GetEscrowResponse
} from '../types/index.js';

export async function escrowRoutes(fastify: FastifyInstance) {
  // Create escrow
  fastify.post<{ Body: CreateEscrowRequest; Reply: CreateEscrowResponse }>(
    '/',
    async (request, reply) => {
      const { recipientPhone, totalAmountUsd, categories } = request.body;

      if (!recipientPhone || !totalAmountUsd || !categories) {
        return reply.code(400).send({ 
          error: 'recipientPhone, totalAmountUsd, and categories are required' 
        });
      }

      const escrow = generateMockEscrow(totalAmountUsd, categories);
      return escrow;
    }
  );

  // Get escrow by ID
  fastify.get<{ Params: { id: string }; Reply: GetEscrowResponse }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;
      const escrow = generateMockEscrowDetails(id);
      return escrow;
    }
  );
}