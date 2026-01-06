import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

// Define user type
export interface AuthenticatedUser {
  userId: string;
  email?: string;
  role?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader) {
          return reply.status(401).send({ error: 'Missing authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        if (!token) {
          return reply.status(401).send({ error: 'Invalid token format' });
        }

        // Mock user extraction (replace with real JWT verification in production)
        const mockUsers: Record<string, AuthenticatedUser> = {
          'test-token-123': {
            userId: '550e8400-e29b-41d4-a716-446655440000',
            role: 'recipient',
          },
          'test-token-456': {
            userId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            role: 'sender',
          },
        };

        const user = mockUsers[token];
        if (!user) {
          return reply.status(401).send({ error: 'Invalid token' });
        }

        request.user = user;
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Authentication failed' });
      }
    }
  );
};

export default fp(authPlugin, { name: 'auth-plugin' });
