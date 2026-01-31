# Remit Backend - Complete Documentation Index

**Production API:** https://remit-backend-yblg.onrender.com  
**Status:** ✅ Live and Operational

---

## Documentation Files

### 1. **QUICK_REFERENCE.md** ⚡ START HERE (5 min read)
Quick cheat sheet for developers who want fast answers.

**Best for:**
- Quick endpoint lookups
- API format reference
- Common mistakes to avoid
- Fast testing examples

**Contains:**
- Essential endpoints summary
- Phone/amount formats
- Status values
- cURL & JavaScript examples
- Validation rules

---

### 2. **FRONTEND_INTEGRATION_GUIDE.md** 📚 COMPLETE REFERENCE
Comprehensive documentation for all 11 API endpoints.

**Best for:**
- Complete implementation
- Understanding every detail
- Error handling strategies
- Security best practices
- Full workflow examples

**Contains:**
- Complete API overview
- All 11 endpoints with full details
- Request/response examples (JSON)
- 6 complete workflows
- Authentication flow
- Error handling guide
- Security considerations
- Environment setup
- Troubleshooting

---

### 3. **postman_collection.json** 🧪 TESTING TOOL
Ready-to-import Postman collection for testing all endpoints.

**Best for:**
- Quick endpoint testing
- No-code API exploration
- QA teams
- Verifying documentation

**How to use:**
1. Download the file
2. Open Postman → Import
3. Select this file
4. Set variables (BASE_URL, TOKEN, IDs)
5. Execute requests

---

### 4. **DOCUMENTATION_COMPLETE.md** 📋 SESSION SUMMARY
Overview of documentation creation and next steps.

**Best for:**
- Project managers
- Team leads
- Understanding what was created
- Next steps planning

---

## API Endpoints Quick Links

### Authentication
- `POST /auth/send-otp` - Send OTP code
- `POST /auth/verify-otp` - Verify OTP & get token

### Escrows
- `POST /escrows/` - Create escrow
- `GET /escrows/{id}` - Get escrow details

### Payment Requests
- `POST /payment-requests` - Create payment request
- `GET /payment-requests/{id}` - Check status

### Recipients
- `GET /recipients/{id}/daily-spend` - Daily spending limits

### M-Pesa On-Ramp
- `POST /onramp/kes` - Fund escrow with M-Pesa

### M-Pesa Off-Ramp
- `POST /offramp/pay` - Disburse via M-Pesa

### Blockchain
- `GET /blockchain/status` - Contract status
- `GET /blockchain/escrow/{id}` - Escrow blockchain details
- `POST /blockchain/verify-payment` - Verify payment ID
- `POST /blockchain/escrow/{id}/refund` - Request refund
- `GET /blockchain/events` - Contract events
- `GET /blockchain/transactions/{id}` - Transaction history

### Pretium Transactions
- `GET /transactions` - M-Pesa transaction history

---

## Getting Started

### For Frontend Developers
1. **Day 1:** Read QUICK_REFERENCE.md (5 min)
2. **Day 1:** Import postman_collection.json and test endpoints
3. **Day 2-3:** Read FRONTEND_INTEGRATION_GUIDE.md
4. **Day 3+:** Start implementing

### For QA Engineers
1. Import postman_collection.json into Postman
2. Test each endpoint
3. Verify responses match documentation
4. Report any discrepancies

### For Project Managers
1. Read DOCUMENTATION_COMPLETE.md for overview
2. Review API endpoints section
3. Check workflow examples
4. Plan frontend implementation timeline

---

## Key Information

### Production API URL
```
https://remit-backend-yblg.onrender.com
```

### Authentication
```
Authorization: Bearer mock-jwt-token
```
(Phase 1 - will be Privy JWT in Phase 2)

### Phone Number Format
- Kenyan format: `+254700000000` or `0700000000`
- Exactly 9 digits after country code

### Amount Format
- All amounts in cents (smallest unit)
- $100 USD = 10000 cents
- 500 KES = 50000 cents

### HTTP Status Codes
- `200` - OK
- `201` - Created
- `202` - Accepted (queued)
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error
- `503` - Service Unavailable

---

## Common Workflows

### Basic Remittance (Diaspora → Kenya)

```
1. Send OTP → POST /auth/send-otp
2. Verify OTP → POST /auth/verify-otp
3. Create Escrow → POST /escrows/
4. Fund Escrow → POST /onramp/kes (M-Pesa)
5. Payment Request → POST /payment-requests
6. Check Status → GET /payment-requests/{id}
7. Disburse → POST /offramp/pay (M-Pesa)
8. Recipient receives KES
```

See FRONTEND_INTEGRATION_GUIDE.md for complete step-by-step with examples.

---

## Troubleshooting

### "Unauthorized" Error
- Check token format: `Bearer mock-jwt-token`
- Verify Authorization header is present
- Ensure token hasn't expired

### "Invalid phone number format"
- Use `+254700000000` or `0700000000`
- Must have exactly 9 digits after country code
- No spaces or special characters

### "Escrow not found"
- Verify escrowId is a valid UUID
- Check escrow was created successfully
- Ensure user has permission

### "503 Service Unavailable"
- Redis queue temporarily down
- Retry after 30 seconds
- Contact support if persistent

See FRONTEND_INTEGRATION_GUIDE.md for more troubleshooting.

---

## Security Notes

✅ **Do:**
- Store tokens in HttpOnly cookies
- Validate all inputs client-side
- Use HTTPS for all requests
- Implement rate limiting
- Handle errors gracefully

❌ **Don't:**
- Expose tokens in URLs
- Store tokens in localStorage
- Log sensitive data
- Bypass server validation
- Use test tokens in production

---

## Files in This Repository

```
remit_backend/
├── QUICK_REFERENCE.md ................. Cheat sheet (START HERE)
├── FRONTEND_INTEGRATION_GUIDE.md ...... Complete reference
├── postman_collection.json ........... Postman testing tool
├── DOCUMENTATION_COMPLETE.md ......... Session summary
├── README_DOCUMENTATION.md ........... This file
└── ... (other project files)
```

---

## Support

- For API issues: Check FRONTEND_INTEGRATION_GUIDE.md troubleshooting section
- For quick answers: Check QUICK_REFERENCE.md
- For testing: Use postman_collection.json
- For project questions: See DOCUMENTATION_COMPLETE.md

---

## Production Status

| Service | Status |
|---------|--------|
| HTTP Server | ✅ Running |
| Database | ✅ Connected |
| Redis | ✅ Upstash configured |
| Blockchain | ✅ Base network connected |
| M-Pesa Integration | ✅ Operational |
| Queue Processing | ✅ Active |

**API Response Time:** <500ms typical  
**Uptime:** Continuous  
**Last Updated:** January 31, 2026

---

## Version Information

- **API Version:** v1 (current)
- **Backend:** TypeScript/Node.js on Fastify
- **Database:** PostgreSQL
- **Queue System:** BullMQ + Redis (Upstash)
- **Blockchain:** Base network (USDC escrows)

---

**Ready to integrate! Start with QUICK_REFERENCE.md →**
