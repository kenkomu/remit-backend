import { FastifyInstance, FastifyRequest, FastifyReply, RouteGenericInterface } from 'fastify';
import {
    createPaymentRequestWithDailyLimit,
    getDailySpendStatus,
} from '../services/dailySpendService';

// Request body type
interface CreatePaymentRequestBody {
    escrowId: string;
    categoryId: string;
    amountKesCents: number;
    amountUsdCents: number;
    exchangeRate: number;
    merchantName: string;
    merchantAccount?: string;
    invoiceUrl?: string;
    invoiceHash?: string;
}

// Proper RouteGenericInterface
interface CreatePaymentRequestRoute extends RouteGenericInterface {
    Body: CreatePaymentRequestBody;
}

export async function paymentRequestRoutes(fastify: FastifyInstance) {
    /**
     * Create payment request with daily spend enforcement
     */
    fastify.post(
        '/payment-requests',
        {
            preHandler: async (request, reply) => {
                await fastify.authenticate(request, reply);
            },
        },
        async (request: FastifyRequest<CreatePaymentRequestRoute>, reply: FastifyReply) => {
            const {
                escrowId,
                categoryId,
                amountKesCents,
                amountUsdCents,
                exchangeRate,
                merchantName,
                merchantAccount,
                invoiceUrl,
                invoiceHash,
            } = request.body;

            if (!escrowId || !categoryId || !amountKesCents || !amountUsdCents || !exchangeRate || !merchantName) {
                return reply.status(400).send({ error: 'Missing required fields' });
            }

            try {
                const result = await createPaymentRequestWithDailyLimit({
                    recipientId: request.user.userId,
                    escrowId,
                    categoryId,
                    amountKesCents,
                    amountUsdCents,
                    exchangeRate,
                    merchantName,
                    merchantAccount: merchantAccount ?? '',
                    invoiceUrl,
                    invoiceHash,
                });

                return reply.status(201).send({
                    success: true,
                    paymentRequestId: result.paymentRequestId,
                    remainingDailyLimitCents: result.remainingDailyLimitCents,
                    message: 'Payment request created successfully',
                });
            } catch (error) {
                fastify.log.error({ err: error }, 'Payment request creation error');

                const message = (error as Error).message ?? '';

                if (message.includes('Daily limit exceeded')) {
                    return reply.status(403).send({ error: message });
                }
                if (message.includes('not active') || message.includes('not found')) {
                    return reply.status(400).send({ error: message });
                }
                if (message.includes('Insufficient')) {
                    return reply.status(409).send({ error: message });
                }

                return reply.status(500).send({ error: 'Internal server error' });
            }

        }
    );

    /**
     * Get daily spend status
     */
    fastify.get(
        '/daily-spend/status',
        {
            preHandler: async (request, reply) => {
                await fastify.authenticate(request, reply);
            },
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const status = await getDailySpendStatus(request.user.userId);

                return reply.send({
                    dailyLimit: status.dailyLimitCents / 100,
                    spentToday: status.spentTodayCents / 100,
                    remainingToday: status.remainingTodayCents / 100,
                    transactionCount: status.transactionCount,
                    lastTransactionAt: status.lastTransactionAt,
                    limitReached: status.remainingTodayCents === 0,
                });
            } catch (error) {
                fastify.log.error({ err: error }, 'Daily spend status error');
                return reply.status(500).send({ error: 'Internal server error' });
            }

        }
    );
}
