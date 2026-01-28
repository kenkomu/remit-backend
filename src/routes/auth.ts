import { FastifyPluginAsync } from 'fastify';
import { sendOTP, verifyOTP } from '../services/privy.js';

interface SendOtpBody {
  phone: string;
}

interface VerifyOtpBody {
  phone: string;
  otp: string;
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SendOtpBody }>('/send-otp', async (request, reply) => {
    const { phone } = request.body;

    if (!phone) {
      return reply.code(400).send({ error: 'Phone number is required' });
    }

    const regex = /^(?:\+254|0)\d{9}$/;
    if (!regex.test(phone)) {
      return reply.code(400).send({ error: 'Invalid Kenyan phone number format' });
    }

    const result = await sendOTP(phone);
    return reply.code(200).send({ success: result.success });
  });

  fastify.post<{ Body: VerifyOtpBody }>('/verify-otp', async (request, reply) => {
    const { phone, otp } = request.body;

    if (!phone || !otp) {
      return reply.code(400).send({ error: 'Phone and OTP are required' });
    }

    const result = await verifyOTP(phone, otp);

    return reply.code(200).send({
      token: result.token,
    });
  });
};
