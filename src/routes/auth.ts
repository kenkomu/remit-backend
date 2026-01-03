import { FastifyInstance } from 'fastify';
import { sendOTP, verifyOTP } from '../services/privy.js';
import type {
    SendOTPRequest,
    SendOTPResponse,
    VerifyOTPRequest,
    VerifyOTPResponse,
    ErrorResponse
} from '../types/index.js';

export async function authRoutes(fastify: FastifyInstance) {
    // Send OTP
    fastify.post<{
        Body: SendOTPRequest;
        Reply: SendOTPResponse | ErrorResponse;
    }>('/send-otp', async (request, reply) => {
        const { phone } = request.body;

        if (!phone) {
            return reply.code(400).send({ error: 'Phone number is required' });
        }

        return sendOTP(phone);
    });


    // Verify OTP
    fastify.post<{
        Body: VerifyOTPRequest;
        Reply: VerifyOTPResponse | ErrorResponse;
    }>('/verify-otp', async (request, reply) => {
        const { phone, otp } = request.body;

        if (!phone || !otp) {
            return reply.code(400).send({ error: 'Phone and OTP are required' });
        }

        return verifyOTP(phone, otp);
    });

}