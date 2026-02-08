import { FastifyRequest, FastifyReply } from 'fastify';
import { findUserByPhone, createUser } from '../services/database.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
    };
    /** Phone number from auth (used for recipient lookup) */
    recipientPhone?: string;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');

  // PHASE 1: mock token validation
  if (token !== 'mock-jwt-token') {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  /**
   * IMPORTANT:
   * In Phase 1, token → phone mapping is mocked.
   * In Phase 2, this comes from Privy JWT claims.
   */
  const verifiedPhone = '+254112285105';

  // Resolve user
  let user = await findUserByPhone(verifiedPhone);

  if (!user) {
    const userId = await createUser(
      'mock-privy-user-id',
      verifiedPhone,
      'Unknown User'
    );
    request.user = { userId };
    // ✅ DON'T RETURN - continue to route handler
  } else {
    request.user = { userId: user.userId };
    // ✅ DON'T RETURN - continue to route handler
  }

  // Phase 1: Attach verified phone for recipient lookups
  // Phase 2: This will come from JWT claims
  request.recipientPhone = verifiedPhone;

  // ✅ Middleware completed successfully - continue to next handler
}