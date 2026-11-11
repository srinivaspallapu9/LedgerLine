import { pool, resetTestDatabase, TestResult } from './test-helper';
import { PoolClient } from 'pg';

const results: TestResult[] = [];

async function test(name: string, fn: (client: PoolClient) => Promise<void>) {
  const start = Date.now();
  const client = await pool.connect();
  try {
    await fn(client);
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message, durationMs: Date.now() - start });
    console.error(`  ✗ ${name}: ${err.message}`);
  } finally {
    client.release();
  }
}

async function assertRejects(
  fn: () => Promise<any>,
  expectedErrorPattern?: string | RegExp,
  expectedSqlState?: string
) {
  let threw = false;
  try {
    await fn();
  } catch (err: any) {
    threw = true;
    if (expectedSqlState && err.code !== expectedSqlState) {
      throw new Error(
        `Expected SQLSTATE ${expectedSqlState}, but received ${err.code} (${err.message})`
      );
    }
    if (expectedErrorPattern) {
      const msg = err.message || '';
      const matches =
        typeof expectedErrorPattern === 'string'
          ? msg.includes(expectedErrorPattern)
          : expectedErrorPattern.test(msg);
      if (!matches) {
        throw new Error(
          `Expected error to match "${expectedErrorPattern}", but got "${msg}"`
        );
      }
    }
  }
  if (!threw) {
    throw new Error('Expected function to reject, but it resolved successfully');
  }
}

async function runSuite() {
  console.log('\n======================================================');
  console.log('BalanceVault (LedgerLine) V1 Financial Engine Tests');
  console.log('Target DB: PostgreSQL 18.x (localhost:5432/ledgerline_test)');
  console.log('======================================================\n');

  await resetTestDatabase();

  // -------------------------------------------------------------------------
  // 1. SCHEMA TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Schema & Structure Verification ---');

  await test('All 6 domain tables exist in public schema', async (client) => {
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'accounts', 'financial_transactions', 'ledger_entries', 'idempotency_records', 'audit_events')
      ORDER BY table_name;
    `);
    if (res.rows.length !== 6) {
      throw new Error(`Expected 6 tables, found ${res.rows.length}`);
    }
  });

  await test('All 6 PostgreSQL financial enums exist', async (client) => {
    const res = await client.query(`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('user_role', 'account_type', 'account_status', 'transaction_type', 'transaction_status', 'entry_direction')
      ORDER BY typname;
    `);
    if (res.rows.length !== 6) {
      throw new Error(`Expected 6 domain enums, found ${res.rows.length}`);
    }
  });

  await test('Partial index idx_accounts_owner_status exists with WHERE predicate', async (client) => {
    const res = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'accounts' AND indexname = 'idx_accounts_owner_status';
    `);
    if (res.rows.length !== 1) {
      throw new Error('Partial index idx_accounts_owner_status not found');
    }
    if (!res.rows[0].indexdef.includes('account_type = \'CUSTOMER\'')) {
      throw new Error(`Index does not contain required partial predicate: ${res.rows[0].indexdef}`);
    }
  });

  await test('Foreign keys enforce ON DELETE RESTRICT on financial history', async (client) => {
    const res = await client.query(`
      SELECT confdeltype
      FROM pg_constraint
      WHERE conrelid = 'accounts'::regclass AND conname = 'accounts_owner_user_id_fkey';
    `);
    // 'r' in PostgreSQL pg_constraint confdeltype means RESTRICT
    if (res.rows[0].confdeltype !== 'r') {
      throw new Error(`Expected confdeltype 'r' (RESTRICT), got '${res.rows[0].confdeltype}'`);
    }
  });

  // -------------------------------------------------------------------------
  // 2. ACCOUNT INTEGRITY TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Account Invariant & Constraint Tests ---');

  let testUserId: string;
  let customerAccountId1: string;
  let customerAccountId2: string;
  let systemAccountId: string;

  await test('Customer account requires owner_user_id', async (client) => {
    // Attempt inserting CUSTOMER account without owner_user_id
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO accounts (account_number, account_type, currency, balance_paise)
          VALUES ('ACC_ORPHAN_001', 'CUSTOMER', 'INR', 1000);
        `),
      'ck_accounts_owner_type',
      '23514'
    );
  });

  await test('System account must NOT have owner_user_id', async (client) => {
    // Create valid user first
    const userRes = await client.query(`
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES ('Alice Sharma', 'Alice.Sharma@Domain.Com', 'hashed_pwd_123', 'ACCOUNT_HOLDER')
      RETURNING id, email;
    `);
    testUserId = userRes.rows[0].id;

    // Verify email was normalized to lowercase & trimmed by trigger
    if (userRes.rows[0].email !== 'alice.sharma@domain.com') {
      throw new Error(`Email was not normalized: ${userRes.rows[0].email}`);
    }

    // Attempt inserting SYSTEM account with an owner
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO accounts (account_number, owner_user_id, account_type, currency)
          VALUES ('SYS_WITH_OWNER', '${testUserId}', 'SYSTEM', 'INR');
        `),
      'ck_accounts_owner_type',
      '23514'
    );
  });

  await test('Customer account balance cannot be negative', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO accounts (account_number, owner_user_id, account_type, currency, balance_paise)
          VALUES ('ACC_NEG_001', '${testUserId}', 'CUSTOMER', 'INR', -500);
        `),
      'ck_accounts_balance',
      '23514'
    );
  });

  await test('Account currency must equal INR', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO accounts (account_number, owner_user_id, account_type, currency)
          VALUES ('ACC_USD_001', '${testUserId}', 'CUSTOMER', 'USD');
        `),
      'ck_accounts_currency',
      '23514'
    );
  });

  await test('Account version cannot be negative', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO accounts (account_number, owner_user_id, account_type, currency, version)
          VALUES ('ACC_VER_NEG', '${testUserId}', 'CUSTOMER', 'INR', -1);
        `),
      'ck_accounts_version',
      '23514'
    );
  });

  await test('Create valid customer and system accounts', async (client) => {
    const acc1 = await client.query(`
      INSERT INTO accounts (account_number, owner_user_id, account_type, currency, balance_paise)
      VALUES ('ACC_IN_001', '${testUserId}', 'CUSTOMER', 'INR', 100000)
      RETURNING id;
    `);
    customerAccountId1 = acc1.rows[0].id;

    const acc2 = await client.query(`
      INSERT INTO accounts (account_number, owner_user_id, account_type, currency, balance_paise)
      VALUES ('ACC_IN_002', '${testUserId}', 'CUSTOMER', 'INR', 50000)
      RETURNING id;
    `);
    customerAccountId2 = acc2.rows[0].id;

    const sysAcc = await client.query(`
      INSERT INTO accounts (account_number, owner_user_id, account_type, currency, balance_paise)
      VALUES ('SYS_CLEARING_01', NULL, 'SYSTEM', 'INR', 0)
      RETURNING id;
    `);
    systemAccountId = sysAcc.rows[0].id;
  });

  // -------------------------------------------------------------------------
  // 3. TRANSACTION INTEGRITY TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Financial Transaction Invariant Tests ---');

  await test('Transaction amount must be strictly greater than zero', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id
          ) VALUES (
            'TX_ZERO_AMT', 'TRANSFER', 'PENDING', 0, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
          );
        `),
      'ck_transactions_amount',
      '23514'
    );
  });

  await test('TRANSFER requires both source and destination accounts', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id
          ) VALUES (
            'TX_NO_DEST', 'TRANSFER', 'PENDING', 1000, 'INR',
            '${customerAccountId1}', NULL, '${testUserId}'
          );
        `),
      'ck_transactions_accounts',
      '23514'
    );
  });

  await test('TRANSFER source and destination accounts must differ', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id
          ) VALUES (
            'TX_SAME_ACC', 'TRANSFER', 'PENDING', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId1}', '${testUserId}'
          );
        `),
      'ck_transactions_accounts',
      '23514'
    );
  });

  await test('DEPOSIT requires destination account and NO source account', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id
          ) VALUES (
            'TX_DEP_INVALID', 'DEPOSIT', 'PENDING', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
          );
        `),
      'ck_transactions_accounts',
      '23514'
    );
  });

  await test('WITHDRAWAL requires source account and NO destination account', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id
          ) VALUES (
            'TX_WITH_INVALID', 'WITHDRAWAL', 'PENDING', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
          );
        `),
      'ck_transactions_accounts',
      '23514'
    );
  });

  await test('POSTED transaction must have non-null posted_at timestamp', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id, posted_at
          ) VALUES (
            'TX_POST_NO_TIME', 'TRANSFER', 'POSTED', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}', NULL
          );
        `),
      'ck_transactions_posted_time',
      '23514'
    );
  });

  await test('Non-POSTED transaction must have NULL posted_at timestamp', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id, posted_at
          ) VALUES (
            'TX_PEND_WITH_TIME', 'TRANSFER', 'PENDING', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}', now()
          );
        `),
      'ck_transactions_posted_time',
      '23514'
    );
  });

  await test('POSTED transaction cannot have failure_code', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO financial_transactions (
            transaction_ref, transaction_type, status, amount_paise, currency,
            source_account_id, destination_account_id, initiated_by_user_id, posted_at, failure_code
          ) VALUES (
            'TX_POST_FAIL_CODE', 'TRANSFER', 'POSTED', 1000, 'INR',
            '${customerAccountId1}', '${customerAccountId2}', '${testUserId}', now(), 'INSUFFICIENT_FUNDS'
          );
        `),
      'ck_transactions_failure_code',
      '23514'
    );
  });

  // -------------------------------------------------------------------------
  // 4. DOUBLE-ENTRY ACCOUNTING & DEFERRED BALANCING TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Double-Entry Accounting & Deferred Trigger Tests ---');

  await test('Balanced transaction commits successfully with matching debit and credit', async (client) => {
    await client.query('BEGIN;');

    const txRes = await client.query(`
      INSERT INTO financial_transactions (
        transaction_ref, transaction_type, status, amount_paise, currency,
        source_account_id, destination_account_id, initiated_by_user_id
      ) VALUES (
        'TX_VALID_TRANSFER_01', 'TRANSFER', 'PENDING', 25000, 'INR',
        '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
      ) RETURNING id;
    `);
    const txId = txRes.rows[0].id;

    // Insert 2 balanced ledger entries
    await client.query(`
      INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
      VALUES
        ('${txId}', '${customerAccountId1}', 'DEBIT', 25000, 'INR'),
        ('${txId}', '${customerAccountId2}', 'CREDIT', 25000, 'INR');
    `);

    // Transition to POSTED with posted_at timestamp
    await client.query(`
      UPDATE financial_transactions
      SET status = 'POSTED', posted_at = now()
      WHERE id = '${txId}';
    `);

    // Commit triggers deferred assert_posted_transaction_balanced check
    await client.query('COMMIT;');
  });

  await test('POSTED transaction with ZERO ledger entries fails at commit', async (client) => {
    await client.query('BEGIN;');

    await client.query(`
      INSERT INTO financial_transactions (
        transaction_ref, transaction_type, status, amount_paise, currency,
        source_account_id, destination_account_id, initiated_by_user_id, posted_at
      ) VALUES (
        'TX_ZERO_ENTRIES', 'TRANSFER', 'POSTED', 10000, 'INR',
        '${customerAccountId1}', '${customerAccountId2}', '${testUserId}', now()
      );
    `);

    // Deferred trigger fires on COMMIT
    await assertRejects(() => client.query('COMMIT;'), 'requires at least 2 ledger entries', '23514');
    await client.query('ROLLBACK;').catch(() => {});
  });

  await test('POSTED transaction with only ONE ledger entry fails at commit', async (client) => {
    await client.query('BEGIN;');

    const txRes = await client.query(`
      INSERT INTO financial_transactions (
        transaction_ref, transaction_type, status, amount_paise, currency,
        source_account_id, destination_account_id, initiated_by_user_id
      ) VALUES (
        'TX_ONE_ENTRY', 'TRANSFER', 'PENDING', 10000, 'INR',
        '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
      ) RETURNING id;
    `);
    const txId = txRes.rows[0].id;

    // Only one entry inserted
    await client.query(`
      INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
      VALUES ('${txId}', '${customerAccountId1}', 'DEBIT', 10000, 'INR');
    `);

    await client.query(`
      UPDATE financial_transactions
      SET status = 'POSTED', posted_at = now()
      WHERE id = '${txId}';
    `);

    await assertRejects(() => client.query('COMMIT;'), 'requires at least 2 ledger entries', '23514');
    await client.query('ROLLBACK;').catch(() => {});
  });

  await test('POSTED transaction with unbalanced DEBIT and CREDIT totals fails at commit', async (client) => {
    await client.query('BEGIN;');

    const txRes = await client.query(`
      INSERT INTO financial_transactions (
        transaction_ref, transaction_type, status, amount_paise, currency,
        source_account_id, destination_account_id, initiated_by_user_id
      ) VALUES (
        'TX_UNBALANCED_TOTALS', 'TRANSFER', 'PENDING', 20000, 'INR',
        '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
      ) RETURNING id;
    `);
    const txId = txRes.rows[0].id;

    // Debit 20000, Credit 15000 (Mismatch)
    await client.query(`
      INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
      VALUES
        ('${txId}', '${customerAccountId1}', 'DEBIT', 20000, 'INR'),
        ('${txId}', '${customerAccountId2}', 'CREDIT', 15000, 'INR');
    `);

    await client.query(`
      UPDATE financial_transactions
      SET status = 'POSTED', posted_at = now()
      WHERE id = '${txId}';
    `);

    await assertRejects(() => client.query('COMMIT;'), 'is unbalanced', '23514');
    await client.query('ROLLBACK;').catch(() => {});
  });

  await test('POSTED transaction with only DEBIT entries fails at commit', async (client) => {
    await client.query('BEGIN;');

    const txRes = await client.query(`
      INSERT INTO financial_transactions (
        transaction_ref, transaction_type, status, amount_paise, currency,
        source_account_id, destination_account_id, initiated_by_user_id
      ) VALUES (
        'TX_ONLY_DEBIT', 'TRANSFER', 'PENDING', 20000, 'INR',
        '${customerAccountId1}', '${customerAccountId2}', '${testUserId}'
      ) RETURNING id;
    `);
    const txId = txRes.rows[0].id;

    // Two debit entries, zero credit entries
    await client.query(`
      INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
      VALUES
        ('${txId}', '${customerAccountId1}', 'DEBIT', 10000, 'INR'),
        ('${txId}', '${customerAccountId2}', 'DEBIT', 10000, 'INR');
    `);

    await client.query(`
      UPDATE financial_transactions
      SET status = 'POSTED', posted_at = now()
      WHERE id = '${txId}';
    `);

    await assertRejects(() => client.query('COMMIT;'), 'is unbalanced', '23514');
    await client.query('ROLLBACK;').catch(() => {});
  });

  await test('Inserting ledger entry into already POSTED transaction fails immediately', async (client) => {
    // Locate the posted transaction from earlier
    const res = await client.query(`
      SELECT id FROM financial_transactions WHERE transaction_ref = 'TX_VALID_TRANSFER_01';
    `);
    const postedTxId = res.rows[0].id;

    await assertRejects(
      () =>
        client.query(`
          INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
          VALUES ('${postedTxId}', '${customerAccountId1}', 'DEBIT', 500, 'INR');
        `),
      'Cannot insert ledger entry into already POSTED transaction',
      '55000'
    );
  });

  // -------------------------------------------------------------------------
  // 5. IMMUTABILITY TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Ledger & Audit Immutability Tests ---');

  let sampleLedgerEntryId: string;
  let sampleAuditEventId: string;

  await test('Setup sample ledger entry and audit event', async (client) => {
    const entryRes = await client.query(`
      SELECT id FROM ledger_entries LIMIT 1;
    `);
    sampleLedgerEntryId = entryRes.rows[0].id;

    const auditRes = await client.query(`
      INSERT INTO audit_events (
        actor_user_id, event_type, resource_type, resource_id, outcome, details
      ) VALUES (
        '${testUserId}', 'ACCOUNT_CREATED', 'ACCOUNT', '${customerAccountId1}', 'SUCCESS', '{"info": "test"}'
      ) RETURNING id;
    `);
    sampleAuditEventId = auditRes.rows[0].id;
  });

  await test('UPDATE on ledger_entries fails with SQLSTATE 55000', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          UPDATE ledger_entries
          SET amount_paise = amount_paise + 1000
          WHERE id = '${sampleLedgerEntryId}';
        `),
      'Ledger entries are immutable; use a compensating transaction',
      '55000'
    );
  });

  await test('DELETE on ledger_entries fails with SQLSTATE 55000', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          DELETE FROM ledger_entries
          WHERE id = '${sampleLedgerEntryId}';
        `),
      'Ledger entries are immutable; use a compensating transaction',
      '55000'
    );
  });

  await test('UPDATE on audit_events fails with SQLSTATE 55000', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          UPDATE audit_events
          SET outcome = 'FAILURE'
          WHERE id = '${sampleAuditEventId}';
        `),
      'Audit events are immutable and append-only',
      '55000'
    );
  });

  await test('DELETE on audit_events fails with SQLSTATE 55000', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          DELETE FROM audit_events
          WHERE id = '${sampleAuditEventId}';
        `),
      'Audit events are immutable and append-only',
      '55000'
    );
  });

  // -------------------------------------------------------------------------
  // 6. IDEMPOTENCY TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Idempotency Key & State Machine Tests ---');

  const idempotencyKey = 'idemp_req_uuid_9999';
  const originalHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const differentHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef';

  await test('Initial request records IN_PROGRESS state', async (client) => {
    await client.query(`
      INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, state)
      VALUES ('${testUserId}', '${idempotencyKey}', '${originalHash}', 'IN_PROGRESS');
    `);
  });

  await test('Duplicate key with same user fails unique constraint', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, state)
          VALUES ('${testUserId}', '${idempotencyKey}', '${originalHash}', 'IN_PROGRESS');
        `),
      'uq_idempotency_user_key',
      '23505'
    );
  });

  await test('Different user can safely use the same idempotency key', async (client) => {
    const user2Res = await client.query(`
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES ('Bob Verma', 'bob.verma@domain.com', 'hashed_pwd_456', 'ACCOUNT_HOLDER')
      RETURNING id;
    `);
    const user2Id = user2Res.rows[0].id;

    // Allowed because idempotency scope is UNIQUE(user_id, idempotency_key)
    await client.query(`
      INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, state)
      VALUES ('${user2Id}', '${idempotencyKey}', '${originalHash}', 'IN_PROGRESS');
    `);
  });

  await test('Idempotency state machine completion constraints enforced', async (client) => {
    // IN_PROGRESS with non-null completed_at must fail
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, state, completed_at)
          VALUES ('${testUserId}', 'key_invalid_state_1', '${originalHash}', 'IN_PROGRESS', now());
        `),
      'ck_idempotency_completion',
      '23514'
    );

    // COMPLETED with null completed_at must fail
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO idempotency_records (user_id, idempotency_key, request_hash, state, completed_at)
          VALUES ('${testUserId}', 'key_invalid_state_2', '${originalHash}', 'COMPLETED', NULL);
        `),
      'ck_idempotency_completion',
      '23514'
    );
  });

  // -------------------------------------------------------------------------
  // 7. USER NORMALIZATION & DELETION INTEGRITY
  // -------------------------------------------------------------------------
  console.log('\n--- 7. User Normalization & Financial History Protection ---');

  await test('Blank email rejected after trimming', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          INSERT INTO users (full_name, email, password_hash)
          VALUES ('Blank Email Test', '     ', 'some_pwd');
        `),
      'ck_users_email_not_blank',
      '23514'
    );
  });

  await test('Deleting user with financial history fails (ON DELETE RESTRICT)', async (client) => {
    await assertRejects(
      () =>
        client.query(`
          DELETE FROM users WHERE id = '${testUserId}';
        `),
      'accounts_owner_user_id_fkey',
      '23001'
    );
  });

  // -------------------------------------------------------------------------
  // 8. PRISMA CLIENT INTEGRATION
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Prisma Client ORM & BigInt paise Integration ---');

  await test('Prisma Client can create and load relational models with BigInt', async () => {
    const { PrismaClient, UserRole, AccountType, AccountStatus } = await import('@prisma/client');
    const prismaClient = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
    });
    try {
      const u = await prismaClient.user.create({
        data: {
          fullName: 'Prisma Suite User',
          email: 'prisma.suite@balancevault.internal',
          passwordHash: 'hash_secret_123',
          role: UserRole.ACCOUNT_HOLDER,
        },
      });

      const acc = await prismaClient.account.create({
        data: {
          accountNumber: 'ACC_PRISMA_SUITE_01',
          ownerUserId: u.id,
          accountType: AccountType.CUSTOMER,
          status: AccountStatus.ACTIVE,
          balancePaise: BigInt(1250000), // 12,500.00 INR
        },
      });

      const fetched = await prismaClient.account.findUnique({
        where: { id: acc.id },
        include: { owner: true },
      });

      if (!fetched || fetched.balancePaise !== BigInt(1250000) || fetched.owner?.id !== u.id) {
        throw new Error('Prisma Client validation failed on BigInt or relation');
      }
    } finally {
      await prismaClient.$disconnect();
    }
  });

  console.log('\n======================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Execution Summary: ${passedCount} PASSED, ${failedCount} FAILED out of ${results.length} total tests.`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSuite()
  .catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
