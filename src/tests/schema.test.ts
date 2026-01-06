import { pool } from '../services/database';

// Run this test first to see the actual schema
describe('Schema Check', () => {
  it('should display recipients table schema', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'recipients'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n=== RECIPIENTS TABLE COLUMNS ===');
    result.rows.forEach(row => {
      console.log(`${row.column_name} (${row.data_type}) - Nullable: ${row.is_nullable}`);
    });
    
    // Also check what the foreign key references
    const fkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'recipients'
        AND tc.constraint_type = 'FOREIGN KEY';
    `);
    
    console.log('\n=== FOREIGN KEY CONSTRAINTS ===');
    fkResult.rows.forEach(row => {
      console.log(`${row.column_name} -> ${row.foreign_table_name}.${row.foreign_column_name}`);
    });
    
    await pool.end();
  });
});