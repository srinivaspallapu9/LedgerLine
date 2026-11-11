process.env.NODE_ENV = 'test';

import http from 'http';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { app } from '../src/app';
import { resetTestDatabase } from './test-helper';
import { prisma } from '../src/db/prisma';

let server: http.Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function request(path: string, options: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let body: any;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: res.status, body, headers: res.headers };
}

async function runApiTests() {
  console.log('\n======================================================');
  console.log('BalanceVault API End-to-End Integration Tests');
  console.log('======================================================\n');

  await startServer();
  await resetTestDatabase();

  let adminToken: string;
  let customer1Token: string;
  let customer2Token: string;
  let customer1Id: string;
  let customer2Id: string;
  let customer1AccId: string;
  let customer2AccId: string;
  let customer2AccountNumber: string;

  try {
    // 1. Health & Readiness
    console.log('--- 1. Health & Readiness Probes ---');
    const health = await request('/api/health');
    if (health.status !== 200 || health.body.status !== 'ok') {
      throw new Error(`Health probe failed: ${JSON.stringify(health.body)}`);
    }
    console.log('  ✓ GET /api/health returned 200 OK');

    const ready = await request('/api/ready');
    if (ready.status !== 200 || !ready.body.ready) {
      throw new Error(`Readiness probe failed: ${JSON.stringify(ready.body)}`);
    }
    console.log('  ✓ GET /api/ready returned 200 OK (DB connected)');

    // 2. Admin provisioning and login
    console.log('\n--- 2. Admin Provisioning & Bootstrap Endpoint Security ---');
    const bootstrapResponse = await request('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (bootstrapResponse.status !== 404) {
      throw new Error(`Unsafe bootstrap endpoint should not exist, got ${bootstrapResponse.status}`);
    }
    const adminPassword = randomBytes(24).toString('base64url');
    await prisma.user.create({
      data: {
        fullName: 'Lead System Admin',
        email: 'root.admin@balancevault.internal',
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: 'ADMIN',
        isEnabled: true,
      },
    });
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'root.admin@balancevault.internal',
        password: adminPassword,
      }),
    });
    if (adminLogin.status !== 200) {
      throw new Error(`Provisioned admin login failed: ${JSON.stringify(adminLogin.body)}`);
    }
    adminToken = adminLogin.body.data.token;
    console.log('  ✓ Removed public bootstrap endpoint; provisioned admin can log in');

    const escalatedRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Unauthorized Administrator',
        email: 'self.admin@example.com',
        password: 'CustomerPass123!',
        role: 'ADMIN',
      }),
    });
    if (escalatedRegistration.status !== 400) {
      throw new Error(`Public registration must reject role assignment, got ${escalatedRegistration.status}`);
    }
    console.log('  ✓ Public registration rejects ADMIN role assignment');

    // 3. User Registration & Account Auto-Creation
    console.log('\n--- 3. User Registration & Primary Account Provisioning ---');
    const cust1 = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Vikram Mehta',
        email: 'vikram.mehta@example.com',
        password: 'CustomerPass123!',
      }),
    });
    if (cust1.status !== 201) throw new Error(`Registration failed: ${JSON.stringify(cust1.body)}`);
    customer1Token = cust1.body.data.token;
    customer1Id = cust1.body.data.user.id;
    console.log('  ✓ Registered Customer 1 (Vikram Mehta)');

    const cust2 = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Priya Sharma',
        email: 'priya.sharma@example.com',
        password: 'CustomerPass123!',
      }),
    });
    if (cust2.status !== 201) throw new Error(`Registration failed: ${JSON.stringify(cust2.body)}`);
    customer2Token = cust2.body.data.token;
    customer2Id = cust2.body.data.user.id;
    console.log('  ✓ Registered Customer 2 (Priya Sharma)');

    // 4. Accounts Query & Verification
    console.log('\n--- 4. Account Listing & Ownership ---');
    const acc1Res = await request('/api/accounts', {
      headers: { Authorization: `Bearer ${customer1Token}` },
    });
    if (acc1Res.status !== 200 || acc1Res.body.data.accounts.length === 0) {
      throw new Error(`Failed to list accounts for customer 1: ${JSON.stringify(acc1Res.body)}`);
    }
    customer1AccId = acc1Res.body.data.accounts[0].id;
    console.log(`  ✓ Customer 1 primary account verified: ${acc1Res.body.data.accounts[0].accountNumber}`);

    const acc2Res = await request('/api/accounts', {
      headers: { Authorization: `Bearer ${customer2Token}` },
    });
    customer2AccId = acc2Res.body.data.accounts[0].id;
    customer2AccountNumber = acc2Res.body.data.accounts[0].accountNumber;
    console.log(`  ✓ Customer 2 primary account verified: ${acc2Res.body.data.accounts[0].accountNumber}`);

    const unauthenticatedRecipientVerification = await request('/api/accounts/recipients/verify', {
      method: 'POST',
      body: JSON.stringify({ accountNumber: customer2AccountNumber }),
    });
    if (unauthenticatedRecipientVerification.status !== 401) {
      throw new Error('Recipient verification must require authentication');
    }

    const recipientVerification = await request('/api/accounts/recipients/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` },
      body: JSON.stringify({ accountNumber: customer2AccountNumber }),
    });
    if (
      recipientVerification.status !== 200 ||
      recipientVerification.body.data.recipient.displayName !== 'Priya Sharma' ||
      recipientVerification.body.data.recipient.maskedAccountNumber.endsWith(customer2AccountNumber.slice(-2)) !== true ||
      JSON.stringify(recipientVerification.body.data.recipient).includes(customer2AccId) ||
      Object.keys(recipientVerification.body.data.recipient).sort().join(',') !==
        'displayName,eligible,maskedAccountNumber'
    ) {
      throw new Error(`Recipient verification returned unexpected data: ${JSON.stringify(recipientVerification.body)}`);
    }
    const invalidRecipient = await request('/api/accounts/recipients/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` },
      body: JSON.stringify({ accountNumber: 'BV-IN-00000000' }),
    });
    if (invalidRecipient.status !== 404 || invalidRecipient.body.error?.code !== 'RECIPIENT_NOT_ELIGIBLE') {
      throw new Error(`Nonexistent recipient should be rejected without identifying account state: ${JSON.stringify(invalidRecipient.body)}`);
    }
    const malformedRecipient = await request('/api/accounts/recipients/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` },
      body: JSON.stringify({ accountNumber: customer2AccId }),
    });
    if (malformedRecipient.status !== 400) {
      throw new Error(`Recipient verification should reject UUID input: ${JSON.stringify(malformedRecipient.body)}`);
    }
    console.log('  ✓ Recipient verification accepts account numbers and returns only masked/minimal recipient details');

    // Create system reserve clearing account for deposit tests if not present
    await prisma.account.upsert({
      where: { accountNumber: 'SYS_INR_RESERVE_001' },
      update: {},
      create: {
        accountNumber: 'SYS_INR_RESERVE_001',
        accountType: 'SYSTEM',
        status: 'ACTIVE',
        currency: 'INR',
        balancePaise: BigInt(0),
        ownerUserId: null,
      },
    });

    // 5. Deposit Funds
    console.log('\n--- 5. Cash Deposit & Double-Entry Invariants ---');
    const depositRes = await request('/api/transactions/deposit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Idempotency-Key': 'idemp_dep_001',
      },
      body: JSON.stringify({
        destinationAccountId: customer1AccId,
        amountPaise: 500000, // 5,000.00 INR
        description: 'Salary Cash Deposit',
      }),
    });
    if (depositRes.status !== 201) {
      throw new Error(`Deposit failed: ${JSON.stringify(depositRes.body)}`);
    }
    console.log(`  ✓ Deposited 500,000 paise (5,000 INR) to Customer 1 account`);

    // Verify account balance updated
    const balanceCheck = await request(`/api/accounts/${customer1AccId}`, {
      headers: { Authorization: `Bearer ${customer1Token}` },
    });
    if (balanceCheck.body.data.account.balancePaise !== '500000') {
      throw new Error(`Expected balance 500000, got ${balanceCheck.body.data.account.balancePaise}`);
    }
    if (!balanceCheck.body.data.account.reconciliation.isReconciled) {
      throw new Error('Ledger reconciliation mismatch on customer account');
    }
    console.log('  ✓ Customer 1 operational balance matches ledger sum (500,000 paise, isReconciled: true)');

    // 6. Overdraft Prevention on Transfer
    console.log('\n--- 6. Overdraft Prevention ---');
    const overdraftRes = await request('/api/transactions/transfer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` },
      body: JSON.stringify({
        sourceAccountId: customer1AccId,
        destinationAccountNumber: customer2AccountNumber,
        amountPaise: 9999999, // 99,999.99 INR (exceeds balance)
        description: 'Overdraft Attempt',
      }),
    });
    if (overdraftRes.status !== 400 || overdraftRes.body.error?.code !== 'INSUFFICIENT_FUNDS') {
      throw new Error(`Overdraft should return 400 INSUFFICIENT_FUNDS, got ${overdraftRes.status} ${JSON.stringify(overdraftRes.body)}`);
    }
    console.log('  ✓ Overdraft attempt safely rejected with 400 INSUFFICIENT_FUNDS');

    // 7. Atomic Transfer
    console.log('\n--- 7. Atomic Peer-to-Peer Transfer ---');
    const transferRes = await request('/api/transactions/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Idempotency-Key': 'idemp_trf_001',
      },
      body: JSON.stringify({
        sourceAccountId: customer1AccId,
        destinationAccountNumber: customer2AccountNumber,
        amountPaise: 200000, // 2,000.00 INR
        description: 'Dinner Split',
      }),
    });
    if (transferRes.status !== 201) {
      throw new Error(`Transfer failed: ${JSON.stringify(transferRes.body)}`);
    }
    console.log('  ✓ Transferred 200,000 paise (2,000 INR) from Vikram to Priya');

    // Verify both balances
    const checkCust1 = await request(`/api/accounts/${customer1AccId}`, { headers: { Authorization: `Bearer ${customer1Token}` } });
    const checkCust2 = await request(`/api/accounts/${customer2AccId}`, { headers: { Authorization: `Bearer ${customer2Token}` } });
    if (checkCust1.body.data.account.balancePaise !== '300000') throw new Error(`Cust1 balance expected 300000, got ${checkCust1.body.data.account.balancePaise}`);
    if (checkCust2.body.data.account.balancePaise !== '200000') throw new Error(`Cust2 balance expected 200000, got ${checkCust2.body.data.account.balancePaise}`);
    console.log('  ✓ Both account balances verified atomically: Cust 1 = 300,000 paise, Cust 2 = 200,000 paise');

    // 8. Idempotency Replay
    console.log('\n--- 8. Idempotency Replay Verification ---');
    const replayRes = await request('/api/transactions/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Idempotency-Key': 'idemp_trf_001',
      },
      body: JSON.stringify({
        sourceAccountId: customer1AccId,
        destinationAccountNumber: customer2AccountNumber,
        amountPaise: 200000,
        description: 'Dinner Split',
      }),
    });
    if (replayRes.status !== 200 || !replayRes.body.isReplay) {
      throw new Error(`Expected replay 200 with isReplay: true, got ${replayRes.status} ${JSON.stringify(replayRes.body)}`);
    }
    console.log('  ✓ Replay with exact same key returned original response with isReplay: true (no duplicate debit)');

    // Replay with different payload must fail with 422
    const mismatchRes = await request('/api/transactions/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customer1Token}`,
        'Idempotency-Key': 'idemp_trf_001',
      },
      body: JSON.stringify({
        sourceAccountId: customer1AccId,
        destinationAccountNumber: customer2AccountNumber,
        amountPaise: 100000, // Different amount!
        description: 'Different description',
      }),
    });
    if (mismatchRes.status !== 422) {
      throw new Error(`Expected 422 for altered payload, got ${mismatchRes.status}`);
    }
    console.log('  ✓ Reusing idempotency key with altered payload rejected with 422 Unprocessable Entity');

    // 9. Concurrency Test: 5 Concurrent Parallel Transfers
    console.log('\n--- 9. High-Concurrency Stress Test ---');
    // Deposit 1,000,000 paise to Cust 1
    await request('/api/transactions/deposit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customer1Token}` },
      body: JSON.stringify({ destinationAccountId: customer1AccId, amountPaise: 1000000 }),
    });

    // Launch 5 parallel transfers of 100,000 paise simultaneously
    const concurrentPromises = [1, 2, 3, 4, 5].map((i) =>
      request('/api/transactions/transfer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customer1Token}`,
          'Idempotency-Key': `idemp_concurrent_${Date.now()}_${i}`,
        },
        body: JSON.stringify({
          sourceAccountId: customer1AccId,
          destinationAccountNumber: customer2AccountNumber,
          amountPaise: 100000,
          description: `Concurrent batch ${i}`,
        }),
      })
    );

    const concurrentResults = await Promise.all(concurrentPromises);
    const successCount = concurrentResults.filter((r) => r.status === 201).length;
    if (successCount !== 5) {
      throw new Error(`Expected all 5 concurrent transfers to succeed, got ${successCount}`);
    }
    console.log('  ✓ 5 simultaneous parallel transfers completed with zero deadlocks or corruption');

    // 10. Admin Metrics & Audit Logs
    console.log('\n--- 10. Admin Metrics & Audit Verification ---');
    const metrics = await request('/api/admin/metrics', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (metrics.status !== 200 || !metrics.body.data.metrics.totalTransactions) {
      throw new Error(`Metrics failed: ${JSON.stringify(metrics.body)}`);
    }
    console.log(`  ✓ Admin metrics verified: ${metrics.body.data.metrics.postedTransactions} transactions posted, deposit base: ${metrics.body.data.metrics.customerDepositBaseINR}`);

    const auditLogs = await request('/api/admin/audit-logs', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (auditLogs.status !== 200 || auditLogs.body.data.logs.length === 0) {
      throw new Error(`Audit logs query failed: ${JSON.stringify(auditLogs.body)}`);
    }
    console.log(`  ✓ System recorded ${auditLogs.body.data.pagination.total} audit events`);

    // 11. Rate Limiting Verification
    console.log('\n--- 11. Rate Limiting Enforcement ---');
    let rateLimited = false;
    for (let i = 0; i < 15; i++) {
      const res = await request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-test-rate-limit': 'true' },
        body: JSON.stringify({ email: 'test.rate@example.com', password: 'Password123!' }),
      });
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    if (!rateLimited) {
      throw new Error('Rate limiter failed to trigger 429 after 15 requests');
    }
    console.log('  ✓ Rate limiter successfully triggered 429 Too Many Requests upon burst threshold');

    console.log('\n======================================================');
    console.log('ALL API END-TO-END INTEGRATION TESTS PASSED (11/11)');
    console.log('======================================================\n');
  } finally {
    await stopServer();
  }
}

runApiTests()
  .catch((err) => {
    console.error('API Test Error:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
