import {
    createPaymentRequestWithDailyLimit,
    getDailySpendStatus,
    adjustDailyLimit
} from '../services/dailySpendService';
import { createUser, createRecipient, createEscrow } from '../services/database';
import { pool } from '../services/database';
import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../utils/crypto';

describe('Daily Spend Enforcement', () => {
    let senderUserId: string;
    let recipientId: string;
    let escrowId: string;
    let categoryId: string;

    beforeAll(async () => {
        // Clean tables
        await pool.query(`
      TRUNCATE TABLE daily_spend, escrows, spending_categories, users, recipients, payment_requests, settlements, audit_logs
      RESTART IDENTITY CASCADE
    `);

        // Create users
        const senderPhone = `0712345678${Math.floor(Math.random() * 10000)}`;
        const recipientPhone = `0798765432${Math.floor(Math.random() * 10000)}`;
        senderUserId = await createUser(uuidv4(), senderPhone, 'Sender Test');
        const recipientUserId = await createUser(uuidv4(), recipientPhone, 'Recipient Test');

        // Create recipient record
        recipientId = await createRecipient(recipientUserId, recipientPhone, 'Recipient Test');

        // Create escrow
        escrowId = await createEscrow({
            senderUserId,
            recipientId,
            totalAmountUsdCents: 100000, // $1000
            categories: [
                { name: 'electricity', allocatedAmountUsdCents: 100000 }
            ]
        });

        // Get category ID
        const catResult = await pool.query(
            'SELECT category_id FROM spending_categories WHERE escrow_id = $1',
            [escrowId]
        );
        categoryId = catResult.rows[0].category_id;
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('createPaymentRequestWithDailyLimit', () => {
        it('should create payment request and deduct from daily limit', async () => {
            const initialStatus = await getDailySpendStatus(recipientId);
            expect(initialStatus.remainingTodayCents).toBe(50000); // $500 default

            const result = await createPaymentRequestWithDailyLimit({
                recipientId,
                escrowId,
                categoryId,
                amountKesCents: 100000, // 1000 KES
                amountUsdCents: 10000, // $100
                exchangeRate: 100,
                merchantName: 'Kenya Power',
                merchantAccount: '1234567890'
            });

            expect(result.paymentRequestId).toBeDefined();
            expect(result.remainingDailyLimitCents).toBe(40000); // $500 - $100 = $400 remaining

            const afterStatus = await getDailySpendStatus(recipientId);
            expect(afterStatus.remainingTodayCents).toBe(40000);
            expect(afterStatus.spentTodayCents).toBe(10000);
            expect(afterStatus.transactionCount).toBe(1);
        });

        it('should reject payment request exceeding daily limit', async () => {
            // First request: $400 remaining, request $300
            await createPaymentRequestWithDailyLimit({
                recipientId,
                escrowId,
                categoryId,
                amountKesCents: 300000,
                amountUsdCents: 30000,
                exchangeRate: 100,
                merchantName: 'Kenya Power',
                merchantAccount: '1234567890'
            });

            const status = await getDailySpendStatus(recipientId);
            expect(status.remainingTodayCents).toBe(10000); // $400 - $300 = $100 remaining

            // Second request: $100 remaining, request $200 (should fail)
            await expect(
                createPaymentRequestWithDailyLimit({
                    recipientId,
                    escrowId,
                    categoryId,
                    amountKesCents: 200000,
                    amountUsdCents: 20000,
                    exchangeRate: 100,
                    merchantName: 'Water Company',
                    merchantAccount: '0987654321'
                })
            ).rejects.toThrow('Daily limit exceeded');
        });

        it('should prevent race conditions with concurrent requests', async () => {
            // Reset daily spend for this test
            await pool.query(
                'DELETE FROM daily_spend WHERE recipient_id = $1',
                [recipientId]
            );

            const initialStatus = await getDailySpendStatus(recipientId);
            expect(initialStatus.remainingTodayCents).toBe(50000);

            // Create multiple concurrent requests
            const requests = [
                { amountUsdCents: 20000, merchantName: 'Merchant A' },
                { amountUsdCents: 20000, merchantName: 'Merchant B' },
                { amountUsdCents: 20000, merchantName: 'Merchant C' }
            ];

            const results = await Promise.allSettled(
                requests.map(req =>
                    createPaymentRequestWithDailyLimit({
                        recipientId,
                        escrowId,
                        categoryId,
                        amountKesCents: req.amountUsdCents * 100, // Convert to KES
                        amountUsdCents: req.amountUsdCents,
                        exchangeRate: 100,
                        merchantName: req.merchantName,
                        merchantAccount: '1234567890'
                    })
                )
            );

            // Only first two should succeed (total $600 > $500 limit)
            const successful = results.filter(r => r.status === 'fulfilled');
            const failed = results.filter(r => r.status === 'rejected');

            expect(successful.length).toBe(2);
            expect(failed.length).toBe(1);

            // Verify total spent doesn't exceed limit
            const finalStatus = await getDailySpendStatus(recipientId);
            expect(finalStatus.spentTodayCents).toBeLessThanOrEqual(50000);
            expect(finalStatus.remainingTodayCents).toBeGreaterThanOrEqual(0);
        });
    });

    describe('adjustDailyLimit', () => {
        it('should adjust daily limit for recipient', async () => {
            // Create a new recipient for this test
            const newRecipientPhone = `0722334455${Math.floor(Math.random() * 10000)}`;
            const newRecipientUserId = await createUser(uuidv4(), newRecipientPhone, 'New Recipient');
            const newRecipientId = await createRecipient(newRecipientUserId, newRecipientPhone, 'New Recipient');

            const adminUserId = senderUserId; // Using sender as admin for test

            // Adjust limit to $1000
            await adjustDailyLimit(newRecipientId, 100000, adminUserId);

            const status = await getDailySpendStatus(newRecipientId);
            expect(status.dailyLimitCents).toBe(100000);
            expect(status.remainingTodayCents).toBe(100000);

            // Make a $300 payment
            await createPaymentRequestWithDailyLimit({
                recipientId: newRecipientId,
                escrowId,
                categoryId,
                amountKesCents: 300000,
                amountUsdCents: 30000,
                exchangeRate: 100,
                merchantName: 'Test Merchant',
                merchantAccount: '1234567890'
            });

            // Adjust limit down to $800 (should work since spent $300)
            await adjustDailyLimit(newRecipientId, 80000, adminUserId);

            const newStatus = await getDailySpendStatus(newRecipientId);
            expect(newStatus.dailyLimitCents).toBe(80000);
            expect(newStatus.spentTodayCents).toBe(30000);
            expect(newStatus.remainingTodayCents).toBe(50000); // $800 - $300 = $500
        });

        it('should reject adjusting limit below today\'s spend', async () => {
            const newRecipientPhone = `0733445566${Math.floor(Math.random() * 10000)}`;
            const newRecipientUserId = await createUser(uuidv4(), newRecipientPhone, 'Another Recipient');
            const newRecipientId = await createRecipient(newRecipientUserId, newRecipientPhone, 'Another Recipient');

            const adminUserId = senderUserId;

            // Make a $400 payment
            await createPaymentRequestWithDailyLimit({
                recipientId: newRecipientId,
                escrowId,
                categoryId,
                amountKesCents: 400000,
                amountUsdCents: 40000,
                exchangeRate: 100,
                merchantName: 'Test Merchant',
                merchantAccount: '1234567890'
            });

            // Try to adjust limit to $300 (below today's $400 spend) - should fail
            await expect(
                adjustDailyLimit(newRecipientId, 30000, adminUserId)
            ).rejects.toThrow("Cannot set limit below today's spend");
        });
    });
});