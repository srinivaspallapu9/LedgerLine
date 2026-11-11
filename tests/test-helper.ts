import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:root@localhost:5432/ledgerline_test?schema=public';

export const pool = new Pool({
  connectionString: TEST_DB_URL,
});

export async function resetTestDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // Truncate all application tables safely in topological order
    await client.query(`
      TRUNCATE TABLE
        audit_events,
        idempotency_records,
        ledger_entries,
        financial_transactions,
        accounts,
        users
      CASCADE;
    `);
  } finally {
    client.release();
  }
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

