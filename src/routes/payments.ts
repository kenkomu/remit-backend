import { FastifyInstance } from 'fastify';
import { generateMockPaymentRequest, generateMockPaymentRequestDetails } from '../utils/fakeData.js';
import type {
    CreatePaymentRequestRequest,
    CreatePaymentRequestResponse,
    GetPaymentRequestResponse,
    ErrorResponse
} from '../types/index.js';


export async function paymentRoutes(fastify: FastifyInstance) {
    // Create payment request
    fastify.post<{
        Body: CreatePaymentRequestRequest;
        Reply: CreatePaymentRequestResponse | ErrorResponse;
    }>('/', async (request, reply) => {
        const { escrowId, category, amountKes } = request.body;

        if (!escrowId || !category || !amountKes) {
            return reply.code(400).send({
                error: 'escrowId, category, and amountKes are required'
            });
        }

        return generateMockPaymentRequest();
    });


    // Get payment request by ID
    fastify.get<{ Params: { id: string }; Reply: GetPaymentRequestResponse }>(
        '/:id',
        async (request, reply) => {
            const { id } = request.params;
            const paymentRequest = generateMockPaymentRequestDetails(id);
            return paymentRequest;
        }
    );
}