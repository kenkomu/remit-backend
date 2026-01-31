# Remit Backend - Frontend Integration Guide

**Production API URL:** `https://remit-backend-yblg.onrender.com`

## Overview

This guide provides complete documentation for integrating the Remit Backend API with your frontend application. The API supports cross-border remittance with invoice-locked spending controls, M-Pesa integration, and blockchain-based USDC transfers.

## Table of Contents

1. [Authentication](#authentication)
2. [API Endpoints](#api-endpoints)
3. [Complete Workflow Examples](#complete-workflow-examples)
4. [Error Handling](#error-handling)
5. [Environment Setup](#environment-setup)
6. [Security Considerations](#security-considerations)

---

## Authentication

### Overview

The API uses bearer token authentication. Currently, the system uses mock tokens for Phase 1 development.

**Note:** Phase 2 will integrate Privy for OTP-based authentication.

### Mock Token (Phase 1)

```
Authorization: Bearer mock-jwt-token
```

### Token Structure (Phase 2 - Privy)

Privy-issued JWT tokens will be exchanged via OTP verification.

---

## API Endpoints

All endpoints are relative to: `https://remit-backend-yblg.onrender.com`

### Health Check

Check if the backend is operational.

```
GET /health
```

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

---

### 1. Authentication Routes (`/auth`)

#### Send OTP

Initiate OTP-based authentication by sending a code to a Kenyan phone number.

```
POST /auth/send-otp
```

**Request Body:**
```json
{
  "phone": "+254700000000"
}
```

**Phone Format:**
- Required: Valid Kenyan number
- Accepted formats:
  - `+254XXXXXXXXX` (with +254 prefix)
  - `0XXXXXXXXX` (without +254 prefix)
- Example: `+254700000000` or `0700000000`

**Response (200 OK):**
```json
{
  "success": true
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Invalid Kenyan phone number format"
}
```

---

#### Verify OTP

Verify the OTP code and receive an authentication token.

```
POST /auth/verify-otp
```

**Request Body:**
```json
{
  "phone": "+254700000000",
  "otp": "123456"
}
```

**Response (200 OK):**
```json
{
  "token": "mock-jwt-token"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Phone and OTP are required"
}
```

---

### 2. Escrow Routes (`/escrows`)

Escrows represent locked funds with category-based spending controls.

#### Create Escrow

Create a new escrow with categories for spending control.

```
POST /escrows/
Authorization: Bearer mock-jwt-token
```

**Request Body:**
```json
{
  "recipientPhone": "+254700000001",
  "totalAmountUsd": 1000,
  "categories": [
    {
      "name": "School Fees",
      "amountUsd": 500
    },
    {
      "name": "Medical",
      "amountUsd": 300
    },
    {
      "name": "Groceries",
      "amountUsd": 200
    }
  ]
}
```

**Field Descriptions:**
- `recipientPhone`: Phone number of the recipient (Kenyan format)
- `totalAmountUsd`: Total amount in USD (must match sum of categories)
- `categories`: Array of spending categories with allocated amounts

**Response (201 Created):**
```json
{
  "escrowId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending_deposit",
  "totalAmountUsd": 1000
}
```

**Response (400 Bad Request):**
```json
{
  "error": "recipientPhone, totalAmountUsd, and categories are required"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized"
}
```

---

#### Get Escrow Details

Retrieve escrow information and category spending status.

```
GET /escrows/{escrowId}
```

**Path Parameters:**
- `escrowId`: UUID of the escrow

**Response (200 OK):**
```json
{
  "escrowId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending_deposit",
  "spentUsd": 300,
  "categories": [
    {
      "name": "School Fees",
      "remainingUsd": 500
    },
    {
      "name": "Medical",
      "remainingUsd": 300
    },
    {
      "name": "Groceries",
      "remainingUsd": 200
    }
  ]
}
```

**Response (404 Not Found):**
```json
{
  "error": "Escrow not found"
}
```

---

### 3. Payment Request Routes (`/payment-requests`)

Payment requests represent individual withdrawal requests from an escrow.

#### Create Payment Request

Submit a payment request against an escrow category.

```
POST /payment-requests
Authorization: Bearer mock-jwt-token
```

**Request Body:**
```json
{
  "escrowId": "550e8400-e29b-41d4-a716-446655440000",
  "categoryId": "school-fees-cat-001",
  "amountKesCents": 50000,
  "amountUsdCents": 38500,
  "exchangeRate": 129.87,
  "merchantName": "ABC School",
  "merchantAccount": "school@school.ac.ke"
}
```

**Field Descriptions:**
- `escrowId`: UUID of the escrow
- `categoryId`: Category identifier (e.g., "School Fees")
- `amountKesCents`: Amount in KES (in cents, so 50000 = 500 KES)
- `amountUsdCents`: Amount in USD (in cents, so 38500 = $385 USD)
- `exchangeRate`: KES to USD exchange rate (e.g., 129.87)
- `merchantName`: Name of merchant/recipient
- `merchantAccount`: Account identifier or email

**Calculations:**
```
amountKesCents = amount_in_kes * 100
amountUsdCents = amount_in_usd * 100
exchangeRate = kes_amount / usd_amount
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "paymentRequestId": "770e8400-e29b-41d4-a716-446655440111",
  "paymentId": "880e8400-e29b-41d4-a716-446655440222",
  "status": "onchain_pending"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Missing required fields"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Escrow not found"
}
```

---

#### Get Payment Request Status

Retrieve the current status of a payment request.

```
GET /payment-requests/{paymentRequestId}
Authorization: Bearer mock-jwt-token
```

**Path Parameters:**
- `paymentRequestId`: UUID of the payment request

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "payment_request_id": "770e8400-e29b-41d4-a716-446655440111",
    "status": "onchain_done_offramp_pending",
    "onchain_status": "broadcasted",
    "transaction_hash": "0x1234567890abcdef...",
    "offramp_status": "pending",
    "contract_address": "0x0987654321fedcba...",
    "smart_contract_enabled": true
  }
}
```

**Status Values:**
- `pending`: Awaiting approval
- `onchain_pending`: Smart contract processing
- `onchain_done_offramp_pending`: Blockchain confirmed, waiting for M-Pesa disbursement
- `completed`: Payment completed
- Other statuses as returned from system

**Response (404 Not Found):**
```json
{
  "error": "Payment request not found"
}
```

---

### 4. Recipient Routes (`/recipients`)

#### Get Recipient Daily Spend Status

Check daily spending limits for a recipient.

```
GET /recipients/{recipientId}/daily-spend
```

**Path Parameters:**
- `recipientId`: UUID of the recipient

**Response (200 OK):**
```json
{
  "dailyLimitUsd": 500,
  "spentTodayUsd": 150.50,
  "remainingTodayUsd": 349.50,
  "transactionCount": 2,
  "lastTransactionAt": "2024-01-31T14:30:00Z"
}
```

**Response (500 Internal Server Error):**
```json
{
  "error": "Error message"
}
```

---

### 5. On-Ramp Routes (`/onramp`)

Initiate M-Pesa on-ramp to fund an escrow with KES.

#### Initiate KES On-Ramp

Create an on-ramp transaction to receive M-Pesa payment.

```
POST /onramp/kes
Authorization: Bearer mock-jwt-token
```

**Request Body:**
```json
{
  "phone_number": "0700000000",
  "escrow_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Field Descriptions:**
- `phone_number`: Sender's phone number (Kenyan format, must be 0XXXXXXXXX)
- `escrow_id`: UUID of the escrow to fund

**Phone Format:**
- Required format: `0XXXXXXXXX` (10 digits starting with 0)
- Example: `0700000000`

**Response (200 OK):**
```json
{
  "message": "M-Pesa prompt sent",
  "transaction_code": "TXN12345678"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Invalid phone number format"
}
```

**Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized"
}
```

---

### 6. Off-Ramp Routes (`/offramp`)

Disburse funds via M-Pesa to recipient.

#### Initiate KES Off-Ramp

Initiate a disbursement of KES via M-Pesa.

```
POST /offramp/pay
```

**Request Body:**
```json
{
  "paymentRequestId": "770e8400-e29b-41d4-a716-446655440111",
  "phoneNumber": "+254700000001",
  "amountKes": 50000,
  "transactionHash": "0x1234567890abcdef..."
}
```

**Field Descriptions:**
- `paymentRequestId`: UUID of the payment request
- `phoneNumber`: Recipient's phone number (Kenyan format with +254)
- `amountKes`: Amount in KES (must match payment request)
- `transactionHash`: Blockchain transaction hash

**Response (200 OK):**
```json
{
  "message": "Disbursement initiated",
  "transactionCode": "DISBURSE12345678",
  "amountKes": 50000
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Missing required fields"
}
```

---

### 7. Blockchain Routes (`/blockchain`)

#### Get Blockchain Status

Check overall blockchain monitoring and contract status.

```
GET /blockchain/status
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "monitoring": {
      "isActive": true,
      "lastChecked": "2024-01-31T15:45:00Z"
    },
    "contract_balance_usd": 10500.50,
    "wallet_balance_usdc": 5000
  }
}
```

---

#### Get Escrow Blockchain Details

Retrieve blockchain-specific details for an escrow.

```
GET /blockchain/escrow/{escrowId}
```

**Path Parameters:**
- `escrowId`: UUID of the escrow

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "database": {
      "escrowId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "active",
      "totalAmountUsd": 1000,
      "remainingBalanceUsd": 850,
      "spentUsd": 150,
      "contractAddress": "0x1234567890abcdef...",
      "createdAt": "2024-01-31T10:00:00Z",
      "expiresAt": "2024-05-01T10:00:00Z"
    },
    "blockchain": {
      "exists": true,
      "isActive": true,
      "isRefunded": false,
      "remainingAmountEth": "0.5",
      "releasedAmountEth": "0.3",
      "purpose": "School Fees"
    }
  }
}
```

---

#### Verify Payment ID

Check if a payment ID has been used.

```
POST /blockchain/verify-payment
```

**Request Body:**
```json
{
  "paymentId": "880e8400-e29b-41d4-a716-446655440222"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "paymentId": "880e8400-e29b-41d4-a716-446655440222",
    "used": false,
    "message": "Payment ID is available"
  }
}
```

---

#### Refund Escrow

Request a refund of an escrow (owner only).

```
POST /blockchain/escrow/{escrowId}/refund
Authorization: Bearer mock-jwt-token
```

**Path Parameters:**
- `escrowId`: UUID of the escrow

**Request Body (optional):**
```json
{
  "reason": "Changed plans"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Refund queued for processing",
  "escrowId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (403 Forbidden):**
```json
{
  "error": "Access denied"
}
```

**Response (503 Service Unavailable):**
```json
{
  "error": "Queue service unavailable"
}
```

---

#### Deploy Contract

Deploy a new smart contract (admin only).

```
POST /blockchain/deploy-contract
Authorization: Bearer mock-jwt-token
```

**Request Body:**
```json
{
  "backendServiceAddress": "0x1234567890abcdef...",
  "feeCollectorAddress": "0xfedcba9876543210...",
  "deployerAddress": "0xabcdef1234567890..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Contract deployment queued",
  "parameters": {
    "backendServiceAddress": "0x1234567890abcdef...",
    "feeCollectorAddress": "0xfedcba9876543210..."
  }
}
```

---

#### Get Contract Events

Retrieve blockchain contract events.

```
GET /blockchain/events?eventName=PaymentReleased&limit=50&offset=0
```

**Query Parameters:**
- `eventName` (optional): Filter by event type
- `limit` (optional, default: 50): Number of events to return
- `offset` (optional, default: 0): Pagination offset

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "event_name": "PaymentReleased",
        "tx_hash": "0x1234567890abcdef...",
        "block_number": 12345,
        "event_data": {
          "paymentId": "880e8400-e29b-41d4-a716-446655440222",
          "amount": "500"
        },
        "created_at": "2024-01-31T14:30:00Z"
      }
    ],
    "pagination": {
      "limit": 50,
      "offset": 0,
      "total": 1
    }
  }
}
```

---

#### Get Transaction History

Retrieve blockchain transaction history.

```
GET /blockchain/transactions/{escrowId}
```

**Path Parameters:**
- `escrowId` (optional): Filter by escrow ID

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "transaction_id": "770e8400-e29b-41d4-a716-446655440111",
        "escrow_id": "550e8400-e29b-41d4-a716-446655440000",
        "tx_hash": "0x1234567890abcdef...",
        "status": "confirmed",
        "gas_used": "150000",
        "created_at": "2024-01-31T14:30:00Z"
      }
    ],
    "count": 1
  }
}
```

---

### 8. Pretium Transactions Routes (`/transactions`)

Retrieve Pretium (M-Pesa integration) transaction history.

#### Get Transactions

```
GET /transactions?currency=KES&start_date=2024-01-29&end_date=2024-01-31
```

**Query Parameters:**
- `currency`: Transaction currency (e.g., "KES")
- `start_date`: Start date (YYYY-MM-DD format)
- `end_date`: End date (YYYY-MM-DD format)

**Constraints:**
- Date range cannot exceed 3 days
- Dates must be within the last 3 days
- All dates must be in YYYY-MM-DD format

**Response (200 OK):**
```json
{
  "success": true,
  "transactions": [
    {
      "transaction_code": "TXN12345678",
      "amount": "500",
      "currency": "KES",
      "status": "completed",
      "timestamp": "2024-01-31T14:30:00Z"
    }
  ]
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Date range cannot exceed 3 days"
}
```

---

## Complete Workflow Examples

### Workflow 1: Basic Remittance (Send Money to Kenya)

This workflow demonstrates a complete remittance transaction from sender to recipient.

#### Step 1: Authenticate Sender

```bash
curl -X POST https://remit-backend-yblg.onrender.com/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+254700000000"}'
```

Response:
```json
{"success": true}
```

User receives OTP via Privy/SMS. They enter the OTP:

```bash
curl -X POST https://remit-backend-yblg.onrender.com/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+254700000000", "otp": "123456"}'
```

Response:
```json
{"token": "mock-jwt-token"}
```

**Store token** for subsequent requests.

---

#### Step 2: Create Escrow

Sender creates an escrow with spending categories:

```bash
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

Response:
```json
{
  "escrowId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending_deposit",
  "totalAmountUsd": 1000
}
```

**Store escrowId** for future operations.

---

#### Step 3: Fund Escrow with M-Pesa (On-Ramp)

Sender initiates M-Pesa payment to fund the escrow:

```bash
curl -X POST https://remit-backend-yblg.onrender.com/onramp/kes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock-jwt-token" \
  -d '{
    "phone_number": "0700000000",
    "escrow_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

Response:
```json
{
  "message": "M-Pesa prompt sent",
  "transaction_code": "TXN12345678"
}
```

User receives M-Pesa prompt on their phone. They enter PIN to confirm payment.

---

#### Step 4: Recipient Requests Payment

Once funds are in the escrow, the recipient submits a payment request:

```bash
curl -X POST https://remit-backend-yblg.onrender.com/payment-requests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mock-jwt-token" \
  -d '{
    "escrowId": "550e8400-e29b-41d4-a716-446655440000",
    "categoryId": "school-fees",
    "amountKesCents": 6487000,
    "amountUsdCents": 50000,
    "exchangeRate": 129.74,
    "merchantName": "ABC School",
    "merchantAccount": "school@abc.ac.ke"
  }'
```

Response:
```json
{
  "success": true,
  "paymentRequestId": "770e8400-e29b-41d4-a716-446655440111",
  "paymentId": "880e8400-e29b-41d4-a716-446655440222",
  "status": "onchain_pending"
}
```

---

#### Step 5: Check Payment Status

Monitor the payment request status:

```bash
curl -X GET https://remit-backend-yblg.onrender.com/payment-requests/770e8400-e29b-41d4-a716-446655440111 \
  -H "Authorization: Bearer mock-jwt-token"
```

Response:
```json
{
  "success": true,
  "data": {
    "payment_request_id": "770e8400-e29b-41d4-a716-446655440111",
    "status": "onchain_done_offramp_pending",
    "onchain_status": "broadcasted",
    "transaction_hash": "0x1234567890abcdef...",
    "offramp_status": "pending"
  }
}
```

---

#### Step 6: Disburse Payment (Off-Ramp)

Once blockchain confirms, initiate M-Pesa disbursement to recipient:

```bash
curl -X POST https://remit-backend-yblg.onrender.com/offramp/pay \
  -H "Content-Type: application/json" \
  -d '{
    "paymentRequestId": "770e8400-e29b-41d4-a716-446655440111",
    "phoneNumber": "+254700000001",
    "amountKes": 6487000,
    "transactionHash": "0x1234567890abcdef..."
  }'
```

Response:
```json
{
  "message": "Disbursement initiated",
  "transactionCode": "DISBURSE12345678",
  "amountKes": 6487000
}
```

Recipient receives KES via M-Pesa.

---

### Workflow 2: Check Recipient Daily Spending Limits

```bash
# Get recipient ID from escrow or database
RECIPIENT_ID="550e8400-e29b-41d4-a716-446655440001"

curl -X GET https://remit-backend-yblg.onrender.com/recipients/$RECIPIENT_ID/daily-spend
```

Response:
```json
{
  "dailyLimitUsd": 500,
  "spentTodayUsd": 150.50,
  "remainingTodayUsd": 349.50,
  "transactionCount": 2,
  "lastTransactionAt": "2024-01-31T14:30:00Z"
}
```

---

### Workflow 3: Get Blockchain Escrow Details

Check both database and blockchain status of an escrow:

```bash
curl -X GET https://remit-backend-yblg.onrender.com/blockchain/escrow/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "success": true,
  "data": {
    "database": {
      "escrowId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "active",
      "totalAmountUsd": 1000,
      "remainingBalanceUsd": 950,
      "spentUsd": 50,
      "contractAddress": "0x1234567890abcdef...",
      "createdAt": "2024-01-31T10:00:00Z",
      "expiresAt": "2024-05-01T10:00:00Z"
    },
    "blockchain": {
      "exists": true,
      "isActive": true,
      "isRefunded": false,
      "remainingAmountEth": "0.5",
      "releasedAmountEth": "0.05"
    }
  }
}
```

---

## Error Handling

### HTTP Status Codes

The API uses standard HTTP status codes:

| Code | Meaning | Example |
|------|---------|---------|
| 200 | OK | Successful GET request |
| 201 | Created | Successful POST creating resource |
| 202 | Accepted | Request queued for processing |
| 400 | Bad Request | Invalid input or parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Authenticated but not authorized for resource |
| 404 | Not Found | Resource not found |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Queue/Redis service not available |

### Error Response Format

All error responses follow this format:

```json
{
  "error": "Descriptive error message"
}
```

### Common Errors

**Missing Authorization Header:**
```
Status: 401
{
  "error": "Unauthorized"
}
```

**Invalid Token:**
```
Status: 401
{
  "error": "Invalid token"
}
```

**Invalid Phone Format:**
```
Status: 400
{
  "error": "Invalid Kenyan phone number format"
}
```

**Escrow Not Found:**
```
Status: 404
{
  "error": "Escrow not found"
}
```

**Missing Required Fields:**
```
Status: 400
{
  "error": "Missing required fields"
}
```

---

## Environment Setup

### Frontend Configuration

Create a `.env` file in your frontend project:

```
VITE_API_BASE_URL=https://remit-backend-yblg.onrender.com
VITE_API_TIMEOUT=30000
```

### Example Fetch Configuration

```javascript
// utils/api.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_TIMEOUT = import.meta.env.VITE_API_TIMEOUT || 30000;

let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
}

export async function apiRequest(
  method: string,
  endpoint: string,
  body?: any,
  includeAuth: boolean = true
) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (includeAuth && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}

// Usage examples
export async function sendOTP(phone: string) {
  return apiRequest('POST', '/auth/send-otp', { phone }, false);
}

export async function verifyOTP(phone: string, otp: string) {
  const result = await apiRequest('POST', '/auth/verify-otp', { phone, otp }, false);
  setAuthToken(result.token);
  return result;
}

export async function createEscrow(data: any) {
  return apiRequest('POST', '/escrows/', data, true);
}
```

---

## Security Considerations

### 1. Token Management

- Store authentication tokens securely (HttpOnly cookies preferred)
- Refresh tokens before expiration
- Clear tokens on logout
- Never log or expose tokens in frontend code

### 2. Phone Number Validation

- Validate phone numbers before sending to API
- Support both +254 and 0 prefixes
- Validate exactly 9 digits after country code

### 3. Amount Handling

- Always work with cents (multiply by 100) to avoid floating-point errors
- Validate amounts are positive and non-zero
- Ensure exchange rates are current

### 4. CORS and HTTPS

- Backend enforces HTTPS for production
- CORS is configured to accept requests from authorized domains
- Always use HTTPS in production

### 5. Input Validation

Validate all user inputs before sending to API:

```javascript
function isValidKenyanPhone(phone: string): boolean {
  const pattern = /^(?:\+254|0)\d{9}$/;
  return pattern.test(phone);
}

function isValidAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}
```

### 6. Rate Limiting

- API enforces rate limiting (details TBD)
- Implement exponential backoff for retries
- Cache responses when appropriate

### 7. Payment Safety

- Double-check amounts before submission
- Confirm recipient phone number
- Verify escrow status before creating payment requests
- Use transaction hashes for verification

---

## Support and Troubleshooting

### Common Issues

**Q: Getting "Unauthorized" error**
- Verify token is correctly formatted with "Bearer " prefix
- Check token hasn't expired
- Ensure token is being sent with every authenticated request

**Q: Invalid phone number format**
- Ensure phone is in format: +254XXXXXXXXX or 0XXXXXXXXX
- Should have exactly 9 digits after country code
- Examples: +254700000000 or 0700000000

**Q: Escrow not found**
- Verify escrowId is correct UUID
- Check escrow was created successfully
- Ensure user has permission to access escrow

**Q: Queue service unavailable (503)**
- System temporarily cannot process background jobs
- Retry request after waiting 30 seconds
- Contact support if issue persists

### Debug Mode

Enable debug logging:

```javascript
// Enable API request logging
const DEBUG = true;

function apiRequest(...args) {
  if (DEBUG) {
    console.log('API Request:', method, endpoint, body);
  }
  // ... request code
}
```

### Support

For issues or questions:
- GitHub Issues: [Link to repo]
- Email: support@remit.app
- Discord: [Link to community]

---

## API Versioning

Current API Version: **v1** (implied in URL structure)

Future versions will be prefixed (e.g., `/v2/auth/send-otp`)

---

## Rate Limiting

Rate limits are applied per IP/user:
- Authentication endpoints: 5 requests per minute
- Standard endpoints: 100 requests per minute
- Details on limits returned in response headers (TBD)

---

## Changelog

### v1.0.0 (Current)
- Initial API release
- Authentication with mock tokens (Phase 1)
- Escrow creation and management
- Payment request processing
- On-ramp/off-ramp transactions
- Blockchain integration
- M-Pesa integration via Pretium

### v2.0.0 (Planned)
- Privy integration for OTP auth
- Enhanced rate limiting
- Webhook signatures
- API key authentication for partners
- Batch payment operations

---

**Last Updated:** January 31, 2026
**API Status:** Production (https://remit-backend-yblg.onrender.com)
