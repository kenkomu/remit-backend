# Frontend Integration - Quick Reference

**Production API:** `https://remit-backend-yblg.onrender.com`

## Quick Start

### 1. Authentication

```bash
# Send OTP
POST /auth/send-otp
{"phone": "+254700000000"}

# Verify OTP & get token
POST /auth/verify-otp
{"phone": "+254700000000", "otp": "123456"}
# Returns: {"token": "mock-jwt-token"}
```

Use token in all subsequent requests:
```
Authorization: Bearer mock-jwt-token
```

---

## Essential Endpoints

### Escrows
```bash
# Create
POST /escrows/
{"recipientPhone": "+254700000001", "totalAmountUsd": 1000, "categories": [...]}

# Get details
GET /escrows/{escrowId}
```

### Payment Requests
```bash
# Create
POST /payment-requests
{"escrowId": "...", "categoryId": "...", "amountKesCents": 50000, "amountUsdCents": 38500, ...}

# Check status
GET /payment-requests/{paymentRequestId}
```

### M-Pesa (On-Ramp)
```bash
# Send money TO Kenya
POST /onramp/kes
{"phone_number": "0700000000", "escrow_id": "..."}
```

### M-Pesa (Off-Ramp)
```bash
# Receive money FROM Kenya
POST /offramp/pay
{"paymentRequestId": "...", "phoneNumber": "+254700000001", "amountKes": 50000, "transactionHash": "..."}
```

### Blockchain
```bash
# Get contract status
GET /blockchain/status

# Check escrow on-chain
GET /blockchain/escrow/{escrowId}

# Verify payment ID
POST /blockchain/verify-payment
{"paymentId": "..."}
```

---

## Phone Number Formats

Accepted formats for Kenyan numbers:
- `+254700000000` (with country code)
- `0700000000` (without country code)

**Rules:**
- Must have exactly 9 digits after country code
- Valid prefixes: 254 or 0

---

## Amount Formats

All monetary amounts use **cents**:
- `amountKesCents`: 50000 = 500 KES
- `amountUsdCents`: 38500 = $385 USD

Formula:
```
amountCents = amountInOriginalCurrency * 100
```

Exchange rate example:
```
1 USD = 129.74 KES
500 KES = $3.85 USD (approximately)
```

---

## Status Values

Payment Request statuses:
- `pending` - Awaiting approval
- `onchain_pending` - Smart contract processing
- `onchain_done_offramp_pending` - Blockchain confirmed, waiting for M-Pesa
- `completed` - Finished successfully

---

## Typical Transaction Flow

```
1. User authenticates → get token
   POST /auth/verify-otp

2. Sender creates escrow
   POST /escrows/
   
3. Sender funds escrow with M-Pesa
   POST /onramp/kes
   
4. Recipient submits payment request
   POST /payment-requests
   
5. Check payment status
   GET /payment-requests/{id}
   
6. Disburse to recipient's phone
   POST /offramp/pay
   
7. Recipient receives KES via M-Pesa
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (queued) |
| 400 | Bad request / Invalid input |
| 401 | Not authenticated |
| 403 | Not authorized |
| 404 | Not found |
| 500 | Server error |
| 503 | Service unavailable (queue down) |

---

## Headers Required

```javascript
{
  "Content-Type": "application/json",
  "Authorization": "Bearer mock-jwt-token"  // For protected endpoints
}
```

---

## Validation Rules

**Kenyan Phone:**
```javascript
/^(?:\+254|0)\d{9}$/
```

**Amount (USD):**
- Positive number
- Max reasonable: 10000 USD

**Amount (KES):**
- Positive integer (in cents)
- Must match payment request

**Exchange Rate:**
- Positive decimal
- Typical range: 125-135

---

## Common Mistakes to Avoid

1. ❌ Forgetting "Bearer " prefix in token
   ```javascript
   // Wrong
   Authorization: mock-jwt-token
   
   // Correct
   Authorization: Bearer mock-jwt-token
   ```

2. ❌ Using dollars instead of cents
   ```javascript
   // Wrong
   amountUsdCents: 100  // This is $1, not $100
   
   // Correct
   amountUsdCents: 10000  // This is $100
   ```

3. ❌ Wrong phone format
   ```javascript
   // Wrong
   "+254 700 000 000"  // spaces
   "+254 7 00000000"   // incomplete
   
   // Correct
   "+254700000000"
   "0700000000"
   ```

4. ❌ Missing required fields
   ```javascript
   // Wrong - missing merchantName
   {
     "escrowId": "...",
     "categoryId": "...",
     "amountKesCents": 50000
   }
   
   // Correct
   {
     "escrowId": "...",
     "categoryId": "...",
     "amountKesCents": 50000,
     "amountUsdCents": 38500,
     "exchangeRate": 129.74,
     "merchantName": "ABC School",
     "merchantAccount": "school@abc.ac.ke"
   }
   ```

5. ❌ Not checking payment status
   ```javascript
   // Wrong - assume payment is done
   POST /offramp/pay  // immediately after creating request
   
   // Correct - poll status first
   while (status !== 'onchain_done_offramp_pending') {
     GET /payment-requests/{id}
     sleep(2000)
   }
   POST /offramp/pay  // only after blockchain confirms
   ```

---

## Testing the API

### Using cURL

```bash
# Send OTP
curl -X POST https://remit-backend-yblg.onrender.com/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+254700000000"}'

# Verify OTP
curl -X POST https://remit-backend-yblg.onrender.com/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+254700000000", "otp": "123456"}'

# Create escrow (replace TOKEN)
curl -X POST https://remit-backend-yblg.onrender.com/escrows/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock-jwt-token" \
  -d '{
    "recipientPhone": "+254700000001",
    "totalAmountUsd": 1000,
    "categories": [
      {"name": "School Fees", "amountUsd": 500},
      {"name": "Medical", "amountUsd": 300},
      {"name": "Groceries", "amountUsd": 200}
    ]
  }'
```

### Using JavaScript

```javascript
const API = 'https://remit-backend-yblg.onrender.com';
let token;

// Send OTP
async function sendOTP(phone) {
  const res = await fetch(`${API}/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  return res.json();
}

// Verify OTP
async function verifyOTP(phone, otp) {
  const res = await fetch(`${API}/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp })
  });
  const data = await res.json();
  token = data.token;
  return data;
}

// Create escrow
async function createEscrow(escrowData) {
  const res = await fetch(`${API}/escrows/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(escrowData)
  });
  return res.json();
}

// Usage
await sendOTP('+254700000000');
// User enters OTP...
await verifyOTP('+254700000000', '123456');
// Now have token, can create escrow
await createEscrow({
  recipientPhone: '+254700000001',
  totalAmountUsd: 1000,
  categories: [{ name: 'School Fees', amountUsd: 500 }]
});
```

---

## Response Examples

### Success Response
```json
{
  "escrowId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending_deposit",
  "totalAmountUsd": 1000
}
```

### Error Response
```json
{
  "error": "Invalid Kenyan phone number format"
}
```

### Queued Response (202)
```json
{
  "success": true,
  "paymentRequestId": "770e8400-e29b-41d4-a716-446655440111",
  "paymentId": "880e8400-e29b-41d4-a716-446655440222",
  "status": "onchain_pending"
}
```

---

## Useful Tips

1. **Store escrowId after creation** - You'll need it for all payment operations
2. **Poll payment status** - Check `/payment-requests/{id}` periodically (every 2-5 seconds)
3. **Retry failed requests** - Use exponential backoff for transient failures
4. **Log transaction codes** - Store Pretium transaction codes for reconciliation
5. **Handle timeouts** - Set API timeout to 30+ seconds for blockchain operations
6. **Cache exchange rates** - Fetch exchange rate once, reuse for session

---

## Webhook Integrations (Receive Updates)

**M-Pesa Webhooks** - Backend receives updates automatically:
- On-ramp completion
- Off-ramp status changes
- Transaction failures

**Smart Contract Events** - Monitored via polling:
- Payment releases
- Escrow completions
- Refunds processed

No frontend action needed - backend handles these automatically.

---

For complete documentation, see: **FRONTEND_INTEGRATION_GUIDE.md**
