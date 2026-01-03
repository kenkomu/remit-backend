import { FastifyInstance } from 'fastify';
import { sendOTP, verifyOTP } from '../services/privy.js';
import type {
  SendOTPRequest,
  SendOTPResponse,
  VerifyOTPRequest,
  VerifyOTPResponse
} from '../types/index.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Send OTP
  fastify.post<{ Body: SendOTPRequest; Reply: SendOTPResponse }>(
    '/send-otp',
    async (request, reply) => {
      const { phone } = request.body;

      if (!phone) {
        return reply.code(400).send({ error: 'Phone number is required' });
      }

      const result = await sendOTP(phone);
      return result;
    }
  );

  // Verify OTP
  fastify.post<{ Body: VerifyOTPRequest; Reply: VerifyOTPResponse }>(
    '/verify-otp',
    async (request, reply) => {
      const { phone, otp } = request.body;

      if (!phone || !otp) {
        return reply.code(400).send({ error: 'Phone and OTP are required' });
      }

      const result = await verifyOTP(phone, otp);
      return result;
    }
  );
}