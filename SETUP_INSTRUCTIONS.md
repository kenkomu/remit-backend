# Quick Setup Instructions

## File Structure

Your project should look like this:

```
remit_backend/
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── escrows.ts
│   │   ├── payments.ts
│   │   └── webhooks.ts
│   ├── services/
│   │   ├── supabase.ts
│   │   ├── privy.ts
│   │   └── database.ts          ← NEW (create this)
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── fakeData.ts
│       └── crypto.ts             ← NEW (create this)
├── db/
│   ├── 01_schema.sql             ← NEW (SQL files)
│   ├── 02_encryption_guide.md
│   ├── 03_transaction_patterns.sql
│   └── 05_integration_guide.md
├── package.json
├── tsconfig.json
├── .env
└── .env.example
```

## Step 1: Create Missing Files

### 1. Create `src/utils/crypto.ts`
Copy the crypto implementation I just provided above.

### 2. Create `src/services/database.ts`
Copy the fixed database service I just provided above.

### 3. Update `.env.example`

Add these new variables:

```bash
# Existing vars
PORT=3000
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PRIVY_APP_ID=your-app-id
PRIVY_APP_SECRET=your-app-secret

# NEW: Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=remit_production
DATABASE_USER=remit_user
DATABASE_PASSWORD=your_secure_password

# NEW: Encryption (64 hex characters = 32 bytes)
ENCRYPTION_KEY=generate_this_with_command_below
```

### 4. Generate Encryption Key

Run this command to generate a secure encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and add it to your `.env` file.

## Step 2: Install New Dependencies

```bash
npm install pg
npm install --save-dev @types/pg
```

## Step 3: Setup Database

### 3.1 Install PostgreSQL (if not installed)

**macOS:**
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download from https://www.postgresql.org/download/windows/

### 3.2 Create Database

```bash
# Connect to PostgreSQL as superuser
sudo -u postgres psql

# Or on macOS/Windows
psql postgres
```

In the PostgreSQL prompt:

```sql
-- Create database
CREATE DATABASE remit_production;

-- Create user
CREATE USER remit_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE remit_production TO remit_user;

-- Exit
\q
```

### 3.3 Run Schema Migration

```bash
# Navigate to db folder
cd db/

# Run schema (use the password you set above)
psql -U postgres -h 127.0.0.1 -d remit_production -f 01_schema.sql


# Verify tables were created
psql -U remit_user -d remit_production -c "\dt"
```

You should see:

```
             List of relations
 Schema |        Name         | Type  |   Owner    
--------+---------------------+-------+------------
 public | audit_logs          | table | remit_user
 public | daily_spend         | table | remit_user
 public | escrows             | table | remit_user
 public | mpesa_payments      | table | remit_user
 public | payment_requests    | table | remit_user
 public | recipients          | table | remit_user
 public | settlements         | table | remit_user
 public | spending_categories | table | remit_user
 public | users               | table | remit_user
```

## Step 4: Update `.env`

Create your `.env` file with real values:

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_PASSWORD` - the password you set for remit_user
- `ENCRYPTION_KEY` - the key you generated with the command above

## Step 5: Test Database Connection

Create a test file `test-db.ts`:

```typescript
import 'dotenv/config';
import { testConnection, testEncryption } from './src/utils/crypto';
import { pool } from './src/services/database';

async function test() {
  console.log('Testing encryption...');
  const encryptionWorks = testEncryption();
  console.log('✓ Encryption:', encryptionWorks ? 'PASS' : 'FAIL');

  console.log('\nTesting database connection...');
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connection: PASS');
    console.log('  Server time:', result.rows[0].now);
  } catch (error) {
    console.log('✗ Database connection: FAIL');
    console.error(error);
  }

  console.log('\nTesting table existence...');
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('✓ Tables found:', result.rows.length);
    result.rows.forEach(row => console.log('  -', row.table_name));
  } catch (error) {
    console.error('✗ Error checking tables:', error);
  }

  await pool.end();
}

test();
```

Run it:

```bash
npx tsx test-db.ts
```

## Step 6: Update Your Routes (Optional for Now)

You can keep using mock data for now, or update routes to use real database calls. See `05_integration_guide.md` for examples.

## Step 7: Start Development Server

```bash
npm run dev
```

You should see:

```
🚀 Server ready at http://localhost:3000

Available endpoints:
  GET  /health
  POST /auth/send-otp
  POST /auth/verify-otp
  POST /escrows
  GET  /escrows/:id
  POST /payment-requests
  GET  /payment-requests/:id
  POST /webhooks/stripe
  POST /webhooks/mpesa

Supabase client initialized: { url: '...', hasKey: true }
Privy initialized: { appId: '...', hasSecret: true }
```

## Troubleshooting

### Error: "Cannot find module './crypto'"

**Solution:** Make sure you created `src/utils/crypto.ts` with the crypto implementation.

### Error: "ENCRYPTION_KEY environment variable is required"

**Solution:** Add `ENCRYPTION_KEY` to your `.env` file. Generate it with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Error: "password authentication failed for user remit_user"

**Solution:** Check your DATABASE_PASSWORD in `.env` matches what you set in PostgreSQL.

### Error: "database remit_production does not exist"

**Solution:** Create the database:
```bash
psql -U postgres -c "CREATE DATABASE remit_production"
```

### Error: "relation users does not exist"

**Solution:** Run the schema migration:
```bash
psql -U remit_user -d remit_production -f db/01_schema.sql
```

## Next Steps

1. ✅ Database schema created
2. ✅ Encryption module working
3. ✅ Database service layer ready
4. ⏭️ Update routes to use real database (optional)
5. ⏭️ Add authentication middleware
6. ⏭️ Integrate M-Pesa API
7. ⏭️ Deploy to production

## Verification Checklist

- [ ] PostgreSQL installed and running
- [ ] Database `remit_production` created
- [ ] User `remit_user` created with password
- [ ] All 9 tables exist (run `\dt` in psql)
- [ ] `src/utils/crypto.ts` file created
- [ ] `src/services/database.ts` file created
- [ ] `.env` file has `ENCRYPTION_KEY` (64 hex chars)
- [ ] `.env` file has database credentials
- [ ] `npm run dev` starts without errors
- [ ] Test script runs successfully

Once all boxes are checked, you have a production-ready database layer! 🎉