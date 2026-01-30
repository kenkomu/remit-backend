# AGENTS.md - Development Guidelines for Remit Backend

## Project Overview
This is a TypeScript/Node.js backend API for a cross-border remittance platform enabling diaspora workers to send money to Kenya with invoice-locked spending controls. The system integrates with M-Pesa, Stripe, and Ethereum/USDC for financial transactions.

## Development Commands

### Core Commands
```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/
npm run start        # Production server from compiled files
npm test             # Run Vitest test suite
```

### Testing
- Run all tests: `npm test`
- Run specific test file: `npm test path/to/test.test.ts`
- Test environment uses `.env.test` configuration
- Tests cover API routes, database operations, and business logic

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2022 with strict mode enabled
- Module system: ES modules (type: "module")
- Imports: Explicit `.js` extensions for ES module compatibility
- Type safety: Strict mode with comprehensive type definitions

### File Organization
```
src/
├── server.ts           # Entry point
├── app.ts              # Fastify app setup
├── routes/             # API endpoints (use FastifyPluginAsync pattern)
├── services/           # Business logic (database, privy, redis, onchain)
├── middleware/         # Authentication middleware
├── utils/              # Utilities (crypto, logger, fakeData)
├── types/              # TypeScript type definitions
├── jobs/               # Scheduled jobs
├── workers/            # Background workers
├── domain/             # Domain logic
├── tests/              # Unit and integration tests
└── db/                 # SQL schema files
```

### Naming Conventions
- **Files**: kebab-case for directories, camelCase for files
- **Variables**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Database**: snake_case for tables/columns

### Error Handling
- Use consistent HTTP status codes (400, 404, 500)
- Return structured error responses: `{ error: string }`
- Validate input before processing requests
- Log errors appropriately with context

### Route Pattern
```typescript
import { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/endpoint', {
    schema: {
      body: { type: 'object', properties: {...} },
      response: { 200: { type: 'object', properties: {...} } }
    }
  }, async (request, reply) => {
    // Route logic
  });
};

export default plugin;
```

## Database Guidelines

### Financial Safety
- All PII (phone numbers, names) must be encrypted at application level
- Use row-level locking for balance updates
- Implement comprehensive audit trails for financial transactions
- Use CHECK constraints for financial validation
- Follow double-entry patterns for money movement

### Schema Conventions
- Tables use snake_case naming
- Primary keys: `id` (UUID)
- Foreign keys: `table_name_id`
- Timestamps: `created_at`, `updated_at`
- Financial amounts: Use `DECIMAL` with proper precision
- Phone numbers: Store encrypted, include country code

### Migration Pattern
- SQL files in `src/db/` directory
- Heavily comment schema with business logic explanations
- Include indexes for common query patterns
- Add constraints for data integrity

## Security Requirements

### Encryption
- Use the 64-character hex encryption key from environment
- Encrypt all PII before database storage
- Use built-in Node.js crypto module for encryption/decryption

### Authentication
- Privy-based OTP authentication
- Include user context in all sensitive operations
- Validate permissions for financial operations

### External Integrations
- M-Pesa: Kenyan mobile money disbursement
- Stripe: Payment processing
- Ethereum/USDC: On-chain transactions via Ethers.js
- Validate all external API responses

## Testing Guidelines

### Test Structure
```typescript
describe('Feature Name', () => {
  beforeAll(async () => {
    // Setup test data
  });
  
  afterAll(async () => {
    // Cleanup test data
  });
  
  it('should perform action', async () => {
    // Test implementation with assertions
  });
});
```

### Test Coverage
- Unit tests for services and utilities
- Integration tests for API endpoints
- Database operation testing
- Concurrent transaction safety validation
- Error scenario testing

## Business Domain Context

### Remittance Flow
1. Sender (diaspora) creates escrow with spending categories
2. Recipient (Kenyan) requests payments for specific invoices
3. Sender approves individual payment requests
4. System disburses via M-Pesa or other methods

### Spending Categories
- Categories enforce invoice-locked spending
- Examples: School Fees, Medical, Rent, Groceries
- Each category has allocated amount and tracking
- Prevents diversion of funds from intended purpose

### Kenyan Context
- M-Pesa integration for mobile money
- Kenyan phone number validation (+254 prefix)
- KES currency support with proper conversion
- Compliance with Kenyan financial regulations

## Environment Configuration

### Required Variables
- Database connection (host, port, name, user, password)
- Encryption key (64-character hex string)
- Privy authentication (app ID, secret)
- Supabase configuration
- Redis connection for queues

### Development Setup
- Use `.env.test` for testing
- Reference `.env.example` for required variables
- Never commit actual `.env` files

## Queue System

### BullMQ with Redis
- Background job processing for heavy operations
- USDC spending workers
- Daily spend reset jobs
- Use proper error handling and retry logic

## Logging

### Pino Structured Logging
- Include context in all log entries
- Use appropriate log levels (info, warn, error)
- Log financial operations with audit trail context
- Avoid logging sensitive PII data

## Performance Considerations

### Database Optimization
- Use connection pooling (pg)
- Implement proper indexing
- Use transactions for multi-table operations
- Consider read replicas for reporting queries

### API Performance
- Fastify for high-performance HTTP server
- Implement proper caching where appropriate
- Use async/await patterns consistently
- Monitor queue processing times

## Common Patterns

### Service Layer
```typescript
export class ServiceName {
  constructor(private db: DatabaseService) {}
  
  async method(params: ParamType): Promise<ReturnType> {
    // Business logic implementation
  }
}
```

### Error Response
```typescript
if (errorCondition) {
  reply.code(400).send({ error: 'Descriptive error message' });
  return;
}
```

### Database Transaction
```typescript
await this.db.query('BEGIN');
try {
  // Multiple operations
  await this.db.query('COMMIT');
} catch (error) {
  await this.db.query('ROLLBACK');
  throw error;
}
```

## Compliance and Legal

### Financial Regulations
- Treat all financial operations with high security
- Implement proper audit trails
- Consider AML/KYC requirements
- Document compliance measures

### Data Privacy
- Encrypt all PII
- Follow data retention policies
- Implement proper access controls
- Log all data access for audit purposes