import { createUser, createRecipient, createEscrow, approvePaymentRequest } from '../services/database';
import { pool } from '../services/database';
import { v4 as uuidv4 } from 'uuid';

describe('Database Operations', () => {
  let senderUserId: string;
  let recipientId: string;

  beforeAll(async () => {
    // Clean tables
    await pool.query(`
      TRUNCATE TABLE escrows, spending_categories, users, recipients, payment_requests, settlements, audit_logs
      RESTART IDENTITY CASCADE
    `);
    
    // Create users
    const senderPhone = `0712345678${Math.floor(Math.random() * 10000)}`;
    const recipientPhone = `0798765432${Math.floor(Math.random() * 10000)}`;
    senderUserId = await createUser(uuidv4(), senderPhone, 'Sender Test');
    const recipientUserId = await createUser(uuidv4(), recipientPhone, 'Recipient Test');
    
    // Create recipient record
    recipientId = await createRecipient(recipientUserId, recipientPhone, 'Recipient Test');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('createEscrow', () => {
    it('should create escrow with categories', async () => {
      const escrowId = await createEscrow({
        senderUserId,
        recipientId,
        totalAmountUsdCents: 50000,
        categories: [
          { name: 'electricity', allocatedAmountUsdCents: 25000 },
          { name: 'water', allocatedAmountUsdCents: 25000 }
        ]
      });

      expect(escrowId).toBeDefined();
      expect(typeof escrowId).toBe('string');

      const result = await pool.query(
        'SELECT * FROM escrows WHERE escrow_id = $1',
        [escrowId]
      );

      // PostgreSQL returns BIGINT as string
      expect(Number(result.rows[0].total_amount_usd_cents)).toBe(50000);
    });

    it('should reject mismatched category allocations', async () => {
      await expect(
        createEscrow({
          senderUserId,
          recipientId,
          totalAmountUsdCents: 50000,
          categories: [
            { name: 'electricity', allocatedAmountUsdCents: 20000 }
          ]
        })
      ).rejects.toThrow('must equal total amount');
    });
  });

  describe('approvePaymentRequest', () => {
    it('should deduct from escrow and category balances', async () => {
      const escrowId = await createEscrow({
        senderUserId,
        recipientId,
        totalAmountUsdCents: 50000,
        categories: [
          { name: 'electricity', allocatedAmountUsdCents: 50000 }
        ]
      });

      const catResult = await pool.query(
        'SELECT category_id FROM spending_categories WHERE escrow_id = $1',
        [escrowId]
      );
      const categoryId = catResult.rows[0].category_id;

      const paymentRequestIdResult = await pool.query(
        `INSERT INTO payment_requests (
          escrow_id, category_id, requested_by_recipient_id,
          amount_kes_cents, amount_usd_cents, exchange_rate_kes_per_usd,
          merchant_name_encrypted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING payment_request_id`,
        [escrowId, categoryId, recipientId, 100000, 10000, 150, 'encrypted']
      );
      const paymentRequestId = paymentRequestIdResult.rows[0].payment_request_id;

      await approvePaymentRequest({
        paymentRequestId,
        approverUserId: senderUserId,
        escrowId,
        categoryId,
        amountUsdCents: 10000
      });

      const escrowResult = await pool.query(
        'SELECT remaining_balance_usd_cents FROM escrows WHERE escrow_id = $1',
        [escrowId]
      );
      expect(Number(escrowResult.rows[0].remaining_balance_usd_cents)).toBe(40000);

      const categoryResult = await pool.query(
        'SELECT remaining_amount_usd_cents FROM spending_categories WHERE category_id = $1',
        [categoryId]
      );
      expect(Number(categoryResult.rows[0].remaining_amount_usd_cents)).toBe(40000);
    });
  });
});