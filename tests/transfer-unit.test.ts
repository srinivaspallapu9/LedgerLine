import assert from 'node:assert/strict';
import { PoolClient } from 'pg';
import { AccountStatus, AccountType } from '@prisma/client';
import { pool } from '../src/db/pool';
import { TransactionService } from '../src/services/transaction.service';
import { verifyRecipientAccount } from '../src/services/account.service';
import { recipientVerificationSchema, transferSchema } from '../src/validation/schemas';

const sourceId = '550e8400-e29b-41d4-a716-446655440000';
const destinationId = '550e8400-e29b-41d4-a716-446655440001';
const userId = '550e8400-e29b-41d4-a716-446655440002';
const destinationAccountNumber = 'BV-IN-92880846';

interface AccountState {
  id: string;
  account_number: string;
  owner_user_id: string;
  account_type: string;
  status: string;
  currency: string;
  balance_paise: string;
  version: number;
  owner_is_enabled: boolean;
}

interface TestState {
  accounts: Map<string, AccountState>;
  ledgerEntries: Array<{ transactionId: string; accountId: string; direction: string; amountPaise: string }>;
  transactions: Array<{ id: string; status: string }>;
  idempotency: Map<string, Record<string, any>>;
  auditEvents: number;
}

function createState(sourceBalance: string): TestState {
  return {
    accounts: new Map([
      [sourceId, {
        id: sourceId,
        account_number: 'BV-IN-12345678',
        owner_user_id: userId,
        account_type: 'CUSTOMER',
        status: 'ACTIVE',
        currency: 'INR',
        balance_paise: sourceBalance,
        version: 1,
        owner_is_enabled: true,
      }],
      [destinationId, {
        id: destinationId,
        account_number: destinationAccountNumber,
        owner_user_id: 'another-user',
        account_type: 'CUSTOMER',
        status: 'ACTIVE',
        currency: 'INR',
        balance_paise: '500',
        version: 1,
        owner_is_enabled: true,
      }],
    ]),
    ledgerEntries: [],
    transactions: [],
    idempotency: new Map(),
    auditEvents: 0,
  };
}

function createClient(initialState: TestState, failWhenPosting = false) {
  let state = initialState;
  let transactionSnapshot: TestState | null = null;

  const client = {
    async query(sql: string, values: any[] = []) {
      const statement = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      if (statement === 'BEGIN;') {
        transactionSnapshot = structuredClone(state);
        return { rows: [] };
      }
      if (statement === 'COMMIT;') {
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (statement === 'ROLLBACK;') {
        if (transactionSnapshot) state = transactionSnapshot;
        transactionSnapshot = null;
        return { rows: [] };
      }
      if (statement.startsWith('SELECT ID, REQUEST_HASH, STATE, RESPONSE_STATUS, RESPONSE_BODY')) {
        const key = `${values[0]}:${values[1]}`;
        const record = state.idempotency.get(key);
        return { rows: record ? [{ ...record }] : [] };
      }
      if (statement.startsWith('INSERT INTO IDEMPOTENCY_RECORDS')) {
        state.idempotency.set(`${values[0]}:${values[1]}`, {
          request_hash: values[2],
          state: 'IN_PROGRESS',
        });
        return { rows: [] };
      }
      if (statement.startsWith('SELECT A.ID, A.ACCOUNT_NUMBER, A.OWNER_USER_ID')) {
        return {
          rows: Array.from(state.accounts.values())
            .filter((account) => account.id === values[0] || account.account_number === values[1])
            .sort((a, b) => a.id.localeCompare(b.id)),
        };
      }
      if (statement.startsWith('SELECT IS_ENABLED FROM USERS')) {
        const account = Array.from(state.accounts.values()).find(
          (item) => item.owner_user_id === values[0],
        );
        return { rows: account ? [{ is_enabled: account.owner_is_enabled }] : [] };
      }
      if (statement.startsWith('INSERT INTO FINANCIAL_TRANSACTIONS')) {
        const id = `transaction-${state.transactions.length + 1}`;
        state.transactions.push({ id, status: 'PENDING' });
        return { rows: [{ id, created_at: new Date(0) }] };
      }
      if (statement.startsWith('INSERT INTO LEDGER_ENTRIES')) {
        state.ledgerEntries.push(
          { transactionId: values[0], accountId: values[1], direction: 'DEBIT', amountPaise: values[2] },
          { transactionId: values[0], accountId: values[3], direction: 'CREDIT', amountPaise: values[2] },
        );
        return { rows: [] };
      }
      if (statement.startsWith('UPDATE ACCOUNTS')) {
        const account = state.accounts.get(values[1]);
        assert.ok(account, `Test account ${values[1]} should exist`);
        const delta = BigInt(values[0]);
        account.balance_paise = (
          statement.includes('BALANCE_PAISE = BALANCE_PAISE -')
            ? BigInt(account.balance_paise) - delta
            : BigInt(account.balance_paise) + delta
        ).toString();
        account.version += 1;
        return { rows: [] };
      }
      if (statement.startsWith('UPDATE FINANCIAL_TRANSACTIONS') && statement.includes("SET STATUS = 'POSTED'")) {
        if (failWhenPosting) throw new Error('Simulated posting failure');
        const transaction = state.transactions.find((item) => item.id === values[0]);
        assert.ok(transaction);
        transaction.status = 'POSTED';
        return { rows: [{ posted_at: new Date(0) }] };
      }
      if (statement.startsWith('UPDATE IDEMPOTENCY_RECORDS')) {
        const record = state.idempotency.get(`${values[0]}:${values[1]}`);
        assert.ok(record);
        Object.assign(record, {
          state: 'COMPLETED',
          transaction_id: values[2],
          response_status: values[3],
          response_body: JSON.parse(values[4]),
        });
        return { rows: [] };
      }
      if (statement.startsWith('INSERT INTO AUDIT_EVENTS')) {
        state.auditEvents += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in transfer unit test: ${statement}`);
    },
    release() {},
    getState() {
      return state;
    },
  };

  return client;
}

async function withTestClient<T>(
  client: ReturnType<typeof createClient>,
  callback: () => Promise<T>,
): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(pool, 'connect');
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    value: async () => client as unknown as PoolClient,
  });
  try {
    return await callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(pool, 'connect', originalDescriptor);
    } else {
      Reflect.deleteProperty(pool, 'connect');
    }
  }
}

async function main() {
  const validPayload = {
    sourceAccountId: sourceId,
    destinationAccountNumber,
    amountPaise: '2500',
  };
  assert.equal(transferSchema.safeParse(validPayload).success, true);
  assert.equal(
    transferSchema.safeParse({ ...validPayload, destinationAccountNumber: '1234567890' }).success,
    false,
  );
  assert.equal(transferSchema.safeParse({ ...validPayload, idempotencyKey: 'test-key' }).success, true);
  assert.equal(transferSchema.safeParse({ ...validPayload, destinationAccountId: destinationId }).success, false);
  assert.equal(transferSchema.safeParse({ ...validPayload, amountPaise: '0' }).success, false);
  assert.equal(transferSchema.safeParse({ ...validPayload, amountPaise: '12.5' }).success, false);
  assert.equal(
    transferSchema.safeParse({ ...validPayload, amountPaise: '9223372036854775808' }).success,
    false,
  );
  assert.equal(transferSchema.safeParse({ ...validPayload, amountPaise: 12.5 }).success, false);
  assert.equal(recipientVerificationSchema.safeParse({ accountNumber: destinationAccountNumber }).success, true);
  assert.equal(recipientVerificationSchema.safeParse({ accountNumber: 'BV-IN-1234' }).success, false);
  assert.equal(recipientVerificationSchema.safeParse({ accountNumber: destinationId }).success, false);

  let lookedUpAccountNumber = '';
  const verifiedRecipient = await verifyRecipientAccount('bv-in-92880846', async (accountNumber) => {
    lookedUpAccountNumber = accountNumber;
    return {
      accountNumber: destinationAccountNumber,
      status: AccountStatus.ACTIVE,
      accountType: AccountType.CUSTOMER,
      ownerUserId: 'recipient-user',
      owner: { fullName: 'Recipient Example', isEnabled: true },
    };
  });
  assert.equal(lookedUpAccountNumber, destinationAccountNumber);
  assert.deepEqual(verifiedRecipient, {
    displayName: 'Recipient Example',
    maskedAccountNumber: 'BV-IN-******46',
    eligible: true,
  });
  assert.equal(JSON.stringify(verifiedRecipient).includes('recipient-user'), false);
  assert.equal(JSON.stringify(verifiedRecipient).includes('@'), false);
  await assert.rejects(
    verifyRecipientAccount(destinationAccountNumber, async () => null),
    (error: any) => error.code === 'RECIPIENT_NOT_ELIGIBLE',
  );
  for (const ineligible of [
    { status: AccountStatus.FROZEN, accountType: AccountType.CUSTOMER, ownerUserId: 'recipient-user', owner: { fullName: 'Recipient', isEnabled: true } },
    { status: AccountStatus.CLOSED, accountType: AccountType.CUSTOMER, ownerUserId: 'recipient-user', owner: { fullName: 'Recipient', isEnabled: true } },
    { status: AccountStatus.ACTIVE, accountType: AccountType.SYSTEM, ownerUserId: null, owner: null },
    { status: AccountStatus.ACTIVE, accountType: AccountType.CUSTOMER, ownerUserId: 'recipient-user', owner: { fullName: 'Recipient', isEnabled: false } },
  ]) {
    await assert.rejects(
      verifyRecipientAccount(destinationAccountNumber, async () => ({
        accountNumber: destinationAccountNumber,
        ...ineligible,
      })),
      (error: any) => error.code === 'RECIPIENT_NOT_ELIGIBLE',
    );
  }

  const client = createClient(createState('10000'));
  const firstResult = await withTestClient(client, () =>
    TransactionService.transfer(
      userId,
      {
        sourceAccountId: sourceId,
        destinationAccountNumber,
        amountPaise: 2500n,
        idempotencyKey: 'same-request',
      },
      'ACCOUNT_HOLDER',
    ),
  );
  const stateAfterTransfer = client.getState();
  assert.equal(stateAfterTransfer.accounts.get(sourceId)?.balance_paise, '7500');
  assert.equal(stateAfterTransfer.accounts.get(destinationId)?.balance_paise, '3000');
  assert.equal(stateAfterTransfer.ledgerEntries.length, 2);
  assert.deepEqual(
    stateAfterTransfer.ledgerEntries.map(({ direction, amountPaise }) => [direction, amountPaise]),
    [['DEBIT', '2500'], ['CREDIT', '2500']],
  );
  assert.equal(stateAfterTransfer.transactions[0].status, 'POSTED');
  assert.equal(stateAfterTransfer.auditEvents, 1);
  assert.equal(firstResult.isReplay, false);
  assert.equal('destinationAccountId' in firstResult.data, false);

  const replayResult = await withTestClient(client, () =>
    TransactionService.transfer(
      userId,
      {
        sourceAccountId: sourceId,
        destinationAccountNumber,
        amountPaise: 2500n,
        idempotencyKey: 'same-request',
      },
      'ACCOUNT_HOLDER',
    ),
  );
  assert.equal(replayResult.isReplay, true);
  assert.equal(client.getState().transactions.length, 1);
  assert.equal(client.getState().ledgerEntries.length, 2);
  assert.equal(client.getState().accounts.get(sourceId)?.balance_paise, '7500');

  const insufficientFundsClient = createClient(createState('1000'));
  await assert.rejects(
    withTestClient(insufficientFundsClient, () =>
      TransactionService.transfer(
        userId,
        {
          sourceAccountId: sourceId,
          destinationAccountNumber,
          amountPaise: 2500n,
          idempotencyKey: 'insufficient-funds',
        },
        'ACCOUNT_HOLDER',
      ),
    ),
    (error: any) => error.code === 'INSUFFICIENT_FUNDS',
  );
  assert.equal(insufficientFundsClient.getState().accounts.get(sourceId)?.balance_paise, '1000');
  assert.equal(insufficientFundsClient.getState().accounts.get(destinationId)?.balance_paise, '500');
  assert.equal(insufficientFundsClient.getState().ledgerEntries.length, 0);
  assert.equal(insufficientFundsClient.getState().transactions.length, 0);
  assert.equal(insufficientFundsClient.getState().idempotency.size, 0);

  const rollbackClient = createClient(createState('10000'), true);
  await assert.rejects(
    withTestClient(rollbackClient, () =>
      TransactionService.transfer(
        userId,
        {
          sourceAccountId: sourceId,
          destinationAccountNumber,
          amountPaise: 2500n,
          idempotencyKey: 'rollback-test',
        },
        'ACCOUNT_HOLDER',
      ),
    ),
    /Simulated posting failure/,
  );
  assert.equal(rollbackClient.getState().accounts.get(sourceId)?.balance_paise, '10000');
  assert.equal(rollbackClient.getState().accounts.get(destinationId)?.balance_paise, '500');
  assert.equal(rollbackClient.getState().ledgerEntries.length, 0);
  assert.equal(rollbackClient.getState().transactions.length, 0);
  assert.equal(rollbackClient.getState().auditEvents, 0);
  assert.equal(rollbackClient.getState().idempotency.size, 0);

  const unauthorizedSourceClient = createClient(createState('10000'));
  unauthorizedSourceClient.getState().accounts.get(sourceId)!.owner_user_id = 'someone-else';
  await assert.rejects(
    withTestClient(unauthorizedSourceClient, () =>
      TransactionService.transfer(
        userId,
        {
          sourceAccountId: sourceId,
          destinationAccountNumber,
          amountPaise: 2500n,
        },
        'ACCOUNT_HOLDER',
      ),
    ),
    (error: any) => error.code === 'UNAUTHORIZED_ACCOUNT_ACCESS',
  );
  assert.equal(unauthorizedSourceClient.getState().ledgerEntries.length, 0);

  for (const ineligibleRecipient of [
    { status: 'FROZEN', account_type: 'CUSTOMER', owner_user_id: 'another-user', owner_is_enabled: true },
    { status: 'CLOSED', account_type: 'CUSTOMER', owner_user_id: 'another-user', owner_is_enabled: true },
    { status: 'ACTIVE', account_type: 'SYSTEM', owner_user_id: '', owner_is_enabled: false },
    { status: 'ACTIVE', account_type: 'CUSTOMER', owner_user_id: 'another-user', owner_is_enabled: false },
  ]) {
    const clientWithIneligibleRecipient = createClient(createState('10000'));
    Object.assign(clientWithIneligibleRecipient.getState().accounts.get(destinationId)!, ineligibleRecipient);
    await assert.rejects(
      withTestClient(clientWithIneligibleRecipient, () =>
        TransactionService.transfer(
          userId,
          {
            sourceAccountId: sourceId,
            destinationAccountNumber,
            amountPaise: 2500n,
          },
          'ACCOUNT_HOLDER',
        ),
      ),
      (error: any) => error.code === 'DESTINATION_ACCOUNT_INACTIVE' || error.code === 'RECIPIENT_NOT_ELIGIBLE',
    );
    assert.equal(clientWithIneligibleRecipient.getState().ledgerEntries.length, 0);
    assert.equal(clientWithIneligibleRecipient.getState().transactions.length, 0);
  }

  console.log('Transfer schema and mocked transaction unit tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
