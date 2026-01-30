# Environment Variables for Remit Backend

## Required Environment Variables

### Database Configuration
```bash
# PostgreSQL database connection
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=remit_db
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
```

### Blockchain Configuration (Base Network)
```bash
# Base L2 network RPC endpoint
BASE_RPC_URL=https://1rpc.io/base

# USDC contract address on Base network
BASE_USDC_CONTRACT=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Wallet private key for blockchain operations (deployer/backend wallet)
BASE_PRIVATE_KEY=0x1234567890abcdef...

# SimpleEscrowUSDC contract address (set after deployment)
SIMPLE_ESCROW_ADDRESS=0x...
```

### Authentication (Privy)
```bash
# Privy app configuration for OTP authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
```

### Supabase Configuration
```bash
# Supabase project details
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### External Services
```bash
# Pretium API for M-Pesa disbursement
PRETIUM_API_URL=https://api.xwift.africa
PRETIUM_API_KEY=your_pretium_api_key

# M-Pesa configuration
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_ENVIRONMENT=sandbox  # or production
```

### Security
```bash
# 64-character hex encryption key for PII encryption
ENCRYPTION_KEY=your_64_character_hex_encryption_key
```

### Queue System
```bash
# Redis connection for BullMQ job queues
REDIS_URL=redis://127.0.0.1:6379
```

### Application
```bash
# Server configuration
PORT=3000
NODE_ENV=development  # or production
```

## USDC Escrow Integration Changes

### ✅ Updated Environment Variables
- `SIMPLE_ESCROW_ADDRESS`: Now points to SimpleEscrowUSDC contract
- `BASE_USDC_CONTRACT`: USDC token contract on Base network

### ❌ Removed Environment Variables
- `ETH_USD_PRICE`: No longer needed (using USDC directly)

## Contract Addresses on Base Network

```bash
# Official Base network contracts
BASE_USDC_CONTRACT=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  # USDC on Base

# Your deployed contracts (update after deployment)
SIMPLE_ESCROW_ADDRESS=0x...  # Your SimpleEscrowUSDC contract
```

## Development Setup

1. **Database Setup:**
   ```bash
   # Apply database migrations
   psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f src/db/01_initial_schema.sql
   psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f src/db/02_spending_categories.sql
   psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f src/db/03_payment_requests.sql
   psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -f src/db/04_blockchain_integration.sql
   ```

2. **Smart Contract Deployment:**
   ```bash
   # Compile the USDC escrow contract
   npx tsx scripts/compile-usdc-escrow.ts
   
   # Deploy to Base network
   npx tsx scripts/deploy-usdc-escrow.ts
   
   # Update SIMPLE_ESCROW_ADDRESS in your .env file
   ```

3. **Fund Wallets:**
   ```bash
   # Fund the deployer wallet with:
   # - ETH for gas fees
   # - USDC for testing escrow operations
   ```

## Testing Configuration

For testing, use `.env.test` with similar configuration but pointing to:
- Test database
- Base testnet RPC
- Test wallets with testnet funds

## Security Notes

- **Never commit `.env` files to version control**
- Use strong encryption keys (64 hex characters)
- Keep private keys secure and never share them
- Use environment-specific configurations
- Regularly rotate API keys and secrets

## Troubleshooting

### Common Issues:

1. **Contract deployment fails:**
   - Check BASE_PRIVATE_KEY has sufficient ETH
   - Verify BASE_RPC_URL is accessible
   - Ensure BASE_USDC_CONTRACT address is correct

2. **USDC operations fail:**
   - Verify wallet has USDC balance
   - Check USDC contract address on Base network
   - Confirm escrow contract has approval to spend USDC

3. **Database connection issues:**
   - Verify DATABASE_* variables are correct
   - Ensure database exists and migrations are applied
   - Check network connectivity to database

4. **Queue processing fails:**
   - Verify Redis is running and REDIS_URL is correct
   - Check worker processes are started
   - Monitor queue health and job failures