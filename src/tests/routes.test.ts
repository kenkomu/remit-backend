import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app';
import { pool, createUser, createRecipient, createEscrow } from '../services/database';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyInstance } from 'fastify';

describe('API Routes', () => {
  let app: FastifyInstance;
  let senderUserId: string;
  let recipientId: string;
  let escrowId: string;
  let categoryId: string;

  beforeAll(async () => {
    // Build Fastify app
    app = await buildApp();

    // Clean up test data
    await pool.query(`
      TRUNCATE TABLE 
        escrows, spending_categories, users, recipients, 
        payment_requests, settlements, audit_logs, daily_spend
      RESTART IDENTITY CASCADE
    `);

    // Create test users
    const senderPhone = `+254712${Math.floor(Math.random() * 1000000)}`;
    const recipientPhone = `+254798${Math.floor(Math.random() * 1000000)}`;

    senderUserId = await createUser(uuidv4(), senderPhone, 'Test Sender');
    const recipientUserId = await createUser(uuidv4(), recipientPhone, 'Test Recipient');
    recipientId = await createRecipient(recipientUserId, recipientPhone, 'Test Recipient');

    // Create test escrow
    escrowId = await createEscrow({
      senderUserId,
      recipientId,
      totalAmountUsdCents: 50000, // $500
      categories: [
        { name: 'electricity', allocatedAmountUsdCents: 30000 },
        { name: 'water', allocatedAmountUsdCents: 20000 }
      ]
    });

    // Get category ID
    const catResult = await pool.query(
      'SELECT category_id FROM spending_categories WHERE escrow_id = $1 AND category_name = $2',
      [escrowId, 'electricity']
    );
    categoryId = catResult.rows[0].category_id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // =====================================================
  // HEALTH CHECK
  // =====================================================

  it('GET /health should return ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  // =====================================================
  // ESCROW ROUTES
  // =====================================================

  it('GET /escrows/:id should return escrow details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/escrows/${escrowId}`
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.escrowId).toBe(escrowId);
    expect(data.status).toBe('active');
    expect(data.categories).toHaveLength(2);
  });

  it('GET /escrows/:id should return 404 for non-existent escrow', async () => {
    const fakeId = uuidv4();
    const response = await app.inject({
      method: 'GET',
      url: `/escrows/${fakeId}`
    });

    expect(response.statusCode).toBe(404);
  });

  // =====================================================
  // PAYMENT REQUEST ROUTES
  // =====================================================

  it('POST /payment-requests should create a payment request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/payment-requests',
      headers: {
        'x-user-id': recipientId // Mock auth
      },
      payload: {
        escrowId,
        category: 'electricity',
        amountKes: 100, // 100 KES = ~0.67 USD at 150 rate
        merchantName: 'Kenya Power',
        merchantAccount: '123456789'
      }
    });

    expect(response.statusCode).toBe(201);
    const data = response.json();
    expect(data.paymentRequestId).toBeDefined();
    expect(data.status).toBe('pending_approval');
    expect(data.amountKes).toBe(100);
  });

  it('POST /payment-requests should enforce daily limit', async () => {
    // First request (should succeed)
    const response1 = await app.inject({
      method: 'POST',
      url: '/payment-requests',
      headers: { 'x-user-id': recipientId },
      payload: {
        escrowId,
        category: 'electricity',
        amountKes: 75000, // 75,000 KES = $500 (hits limit)
        merchantName: 'Test Merchant',
        merchantAccount: '999999'
      }
    });

    expect(response1.statusCode).toBe(201);

    // Second request (should fail - daily limit exceeded)
    const response2 = await app.inject({
      method: 'POST',
      url: '/payment-requests',
      headers: { 'x-user-id': recipientId },
      payload: {
        escrowId,
        category: 'electricity',
        amountKes: 1000, // Even small amount should fail
        merchantName: 'Test Merchant',
        merchantAccount: '999999'
      }
    });

    expect(response2.statusCode).toBe(429); // Too Many Requests
    expect(response2.json().error).toContain('Daily limit exceeded');
  });

  it('POST /payment-requests should be idempotent', async () => {
    // Generate consistent idempotency key
    const timestamp = Date.now();
    const idempotencyKey = `test-${timestamp}`;

    // First request
    const response1 = await app.inject({
      method: 'POST',
      url: '/payment-requests',
      headers: { 
        'x-user-id': recipientId,
        'idempotency-key': idempotencyKey
      },
      payload: {
        escrowId,
        category: 'water',
        amountKes: 50,
        merchantName: 'Water Company',
        merchantAccount: '111111'
      }
    });

    expect(response1.statusCode).toBe(201);
    const paymentRequestId1 = response1.json().paymentRequestId;

    // Second request with same key (should return existing)
    const response2 = await app.inject({
      method: 'POST',
      url: '/payment-requests',
      headers: { 
        'x-user-id': recipientId,
        'idempotency-key': idempotencyKey
      },
      payload: {
        escrowId,
        category: 'water',
        amountKes: 50,
        merchantName: 'Water Company',
        merchantAccount: '111111'
      }
    });

    expect(response2.statusCode).toBe(200); // Not 201
    const paymentRequestId2 = response2.json().paymentRequestId;
    expect(paymentRequestId2).toBe(paymentRequestId1); // Same ID
  });

  // =====================================================
  // DAILY SPEND ROUTES
  // =====================================================

  it('GET /recipients/:id/daily-spend should return spend status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/recipients/${recipientId}/daily-spend`
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.dailyLimitUsd).toBe(500);
    expect(data.spentTodayUsd).toBeGreaterThan(0);
    expect(data.remainingTodayUsd).toBeLessThan(500);
  });

  // =====================================================
  // WEBHOOK ROUTES
  // =====================================================

  it('POST /webhooks/mpesa should accept webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/mpesa',
      payload: {
        Body: {
          stkCallback: {
            ConversationID: 'test-conv-123',
            ResultCode: 0,
            ResultDesc: 'Success',
            TransactionID: 'QGK123TEST'
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().received).toBe(true);
  });

  it('POST /webhooks/stripe should accept webhook', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      payload: {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_test_123' } }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().received).toBe(true);
  });

  // =====================================================
  // AUTH ROUTES (OTP Mocked)
  // =====================================================

  it('POST /auth/send-otp should return success', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/send-otp',
      payload: {
        phone: '+254712345678'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(response.json().otpSent).toBe(true);
  });

  it('POST /auth/verify-otp should return token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      payload: {
        phone: '+254712345678',
        otp: '123456'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeDefined();
    expect(response.json().userId).toBeDefined();
  });
});