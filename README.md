# Remit Backend API - Step 2 MVP

Minimal backend API skeleton using Node.js + Fastify with mocked responses.

## Features

- ✅ TypeScript + Fastify
- ✅ Supabase connection (no queries yet)
- ✅ Privy authentication (mocked OTP flow)
- ✅ All endpoints return fake/mocked data
- ✅ No blockchain, Stripe, or M-Pesa integration yet

## Project Structure

```
src/
├── server.ts           # Entry point
├── app.ts              # Fastify app setup
├── routes/
│   ├── auth.ts         # Auth endpoints
│   ├── escrows.ts      # Escrow endpoints
│   ├── payments.ts     # Payment request endpoints
│   └── webhooks.ts     # Webhook endpoints
├── services/
│   ├── supabase.ts     # Supabase client
│   └── privy.ts        # Privy mock service
├── types/
│   └── index.ts        # TypeScript types
└── utils/
    └── fakeData.ts     # Mock data generators
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```
   
   Update with your values (optional for now, uses mocks by default).

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## API Endpoints

### Health Check
```bash
GET /health
→ { "status": "ok" }
```

### Auth Endpoints (OTP mocked)
```bash
# Send OTP
POST /auth/send-otp
Body: { "phone": "+254712345678" }
Response: { "success": true, "otpSent": true }

# Verify OTP
POST /auth/verify-otp
Body: { "phone": "+254712345678", "otp": "123456" }
Response: { "token": "mock-jwt-token", "userId": "uuid" }
```

### Escrow Endpoints
```bash
# Create escrow
POST /escrows
Body: {
  "recipientPhone": "+254712345678",
  "totalAmountUsd": 500,
  "categories": ["electricity", "water", "rent"]
}
Response: {
  "escrowId": "uuid",
  "status": "active",
  "totalAmountUsd": 500
}

# Get escrow details
GET /escrows/:id
Response: {
  "escrowId": "uuid",
  "status": "active",
  "spentUsd": 50,
  "categories": [
    { "name": "electricity", "remainingUsd": 150 }
  ]
}
```

### Payment Request Endpoints
```bash
# Create payment request
POST /payment-requests
Body: {
  "escrowId": "uuid",
  "category": "electricity",
  "amountKes": 5000
}
Response: {
  "paymentRequestId": "uuid",
  "status": "pending"
}

# Get payment request
GET /payment-requests/:id
Response: {
  "paymentRequestId": "uuid",
  "status": "pending"
}
```

### Webhook Endpoints
```bash
# Stripe webhook (logs payload, returns 200)
POST /webhooks/stripe

# M-Pesa webhook (logs payload, returns 200)
POST /webhooks/mpesa
```

## Testing with cURL

```bash
# Health check
curl http://localhost:3000/health

# Send OTP
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+254712345678"}'

# Create escrow
curl -X POST http://localhost:3000/escrows \
  -H "Content-Type: application/json" \
  -d '{
    "recipientPhone": "+254712345678",
    "totalAmountUsd": 500,
    "categories": ["electricity", "water"]
  }'
```

## Notes

- All responses are mocked - no real external calls
- No database writes yet
- No business logic yet
- No blockchain integration
- No payment provider integration
- This is a scaffold for Step 3 integration

## Next Steps (Step 3)

- Integrate real Privy OTP flow
- Add Supabase database queries
- Integrate Stripe payments
- Integrate M-Pesa payments
- Add blockchain escrow logic
- Add authentication middleware
- Add request validation# remit-backend
