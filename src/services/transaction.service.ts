import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { prisma } from '../db/prisma';
import { AuditService } from './audit.service';
import { IdempotencyService } from './idempotency.service';
import { config } from '../config';

export interface TransferRequest {
  sourceAccountId: string;
  destinationAccountNumber: string;
  amountPaise: bigint;
  description?: string;
  idempotencyKey?: string;
}

export interface DepositRequest {
  destinationAccountId: string;
  amountPaise: bigint;
  description?: string;
  idempotencyKey?: string;
}

export interface WithdrawalRequest {
  sourceAccountId: string;
  amountPaise: bigint;
  description?: string;
  idempotencyKey?: string;
}

export class TransactionService {
  /**
   * Helper to fetch or initialize system reserve account
   */
  private static async getSystemReserveAccount(client: PoolClient): Promise<{ id: string; accountNumber: string }> {
    const res = await client.query(
      `
      SELECT id, account_number, status
      FROM accounts
      WHERE account_type = 'SYSTEM' AND account_number = $1
      FOR UPDATE;
      `,
      [config.systemReserveAccount]
    );

    if (res.rows.length === 0) {
      // Fallback: find any active system account
      const fallbackRes = await client.query(
        `SELECT id, account_number, status FROM accounts WHERE account_type = 'SYSTEM' LIMIT 1 FOR UPDATE;`
      );
      if (fallbackRes.rows.length === 0) {
        throw new Error('System reserve clearing account not found. Run seed script.');
      }
      return fallbackRes.rows[0];
    }

    return res.rows[0];
  }

  /**
   * ATOMIC PEER-TO-PEER TRANSFER
   * Locks accounts in deterministic ascending UUID order to prevent deadlocks under concurrency.
   */
  static async transfer(userId: string, req: TransferRequest, userRole: string, clientIp?: string, userAgent?: string) {
    if (req.amountPaise <= BigInt(0)) {
      throw { status: 400, code: 'INVALID_AMOUNT', message: 'Transfer amount must be strictly greater than zero.' };
    }

    const client = await pool.connect();
    let isIdempotencyLocked = false;
    const requestHash = IdempotencyService.hashPayload({
      type: 'TRANSFER',
      sourceAccountId: req.sourceAccountId,
      destinationAccountNumber: req.destinationAccountNumber.trim().toUpperCase(),
      amountPaise: req.amountPaise.toString(),
    });

    try {
      await client.query('BEGIN;');

      // 1. Idempotency Check
      if (req.idempotencyKey) {
        const idempResult = await IdempotencyService.lockOrCreateRecord(
          client,
          userId,
          req.idempotencyKey,
          requestHash
        );

        if (idempResult.action === 'REPLAY') {
          await client.query('COMMIT;');
          return { isReplay: true, data: idempResult.cachedBody };
        }

        if (idempResult.action === 'CONFLICT') {
          throw {
            status: 409,
            code: 'CONCURRENT_REQUEST',
            message: 'A request with this idempotency key is already in progress.',
          };
        }

        if (idempResult.action === 'PAYLOAD_MISMATCH') {
          throw {
            status: 422,
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Idempotency key reused with a different request payload.',
          };
        }

        isIdempotencyLocked = true;
      }

      // Resolve the recipient by account number while locking both accounts in deterministic order.
      const accRes = await client.query(
        `
        SELECT a.id, a.account_number, a.owner_user_id, a.account_type, a.status,
               a.currency, a.balance_paise, a.version
        FROM accounts a
        WHERE a.id = $1 OR a.account_number = $2
        ORDER BY a.id ASC
        FOR UPDATE OF a;
        `,
        [req.sourceAccountId, req.destinationAccountNumber.trim().toUpperCase()]
      );

      const sourceAccount = accRes.rows.find((r) => r.id === req.sourceAccountId);
      const destAccount = accRes.rows.find(
        (r) => r.account_number === req.destinationAccountNumber.trim().toUpperCase()
      );
      if (!sourceAccount) {
        throw { status: 404, code: 'SOURCE_ACCOUNT_NOT_FOUND', message: 'Source account was not found.' };
      }
      // Check the source before reporting recipient lookup results to avoid leaking recipient existence.
      if (userRole !== 'ADMIN' && sourceAccount.owner_user_id !== userId) {
        throw { status: 403, code: 'UNAUTHORIZED_ACCOUNT_ACCESS', message: 'You do not own the source account.' };
      }
      if (sourceAccount.status !== 'ACTIVE') {
        throw { status: 400, code: 'SOURCE_ACCOUNT_INACTIVE', message: `Source account is ${sourceAccount.status}.` };
      }
      if (!destAccount) {
        throw {
          status: 404,
          code: 'RECIPIENT_NOT_ELIGIBLE',
          message: 'Recipient account could not be verified. Check the account number and try again.',
        };
      }
      if (sourceAccount.id === destAccount.id) {
        throw { status: 400, code: 'IDENTICAL_ACCOUNTS', message: 'Source and destination accounts must be different.' };
      }

      // Revalidate recipient eligibility while its account row remains locked.
      if (destAccount.status !== 'ACTIVE') {
        throw { status: 400, code: 'DESTINATION_ACCOUNT_INACTIVE', message: `Destination account is ${destAccount.status}.` };
      }
      if (
        destAccount.account_type !== 'CUSTOMER' ||
        !destAccount.owner_user_id ||
        destAccount.currency.trim() !== 'INR'
      ) {
        throw {
          status: 400,
          code: 'RECIPIENT_NOT_ELIGIBLE',
          message: 'Recipient account is not eligible to receive transfers.',
        };
      }
      const ownerStatus = await client.query(
        'SELECT is_enabled FROM users WHERE id = $1 FOR SHARE;',
        [destAccount.owner_user_id]
      );
      if (ownerStatus.rows[0]?.is_enabled !== true) {
        throw {
          status: 400,
          code: 'RECIPIENT_NOT_ELIGIBLE',
          message: 'Recipient account is not eligible to receive transfers.',
        };
      }

      // 5. Overdraft Prevention (for customer accounts)
      const currentSourceBalance = BigInt(sourceAccount.balance_paise);
      if (sourceAccount.account_type === 'CUSTOMER' && currentSourceBalance < req.amountPaise) {
        throw {
          status: 400,
          code: 'INSUFFICIENT_FUNDS',
          message: `Insufficient balance. Available: ${currentSourceBalance} paise, Required: ${req.amountPaise} paise.`,
        };
      }

      // 6. Generate Unique Transaction Reference
      const txRef = `TX-TRF-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // 7. Insert Financial Transaction (PENDING)
      const txRes = await client.query(
        `
        INSERT INTO financial_transactions (
          transaction_ref, transaction_type, status, amount_paise, currency,
          source_account_id, destination_account_id, initiated_by_user_id, description
        ) VALUES ($1, 'TRANSFER', 'PENDING', $2, 'INR', $3, $4, $5, $6)
        RETURNING id, created_at;
        `,
        [
          txRef,
          req.amountPaise.toString(),
          sourceAccount.id,
          destAccount.id,
          userId,
          req.description || 'P2P Account Transfer',
        ]
      );
      const transactionId = txRes.rows[0].id;

      // 8. Insert Balanced Immutable Ledger Entries (Source: DEBIT, Destination: CREDIT)
      await client.query(
        `
        INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
        VALUES
          ($1, $2, 'DEBIT', $3, 'INR'),
          ($1, $4, 'CREDIT', $3, 'INR');
        `,
        [transactionId, sourceAccount.id, req.amountPaise.toString(), destAccount.id]
      );

      // 9. Update Operational Balances and Increment Versions
      await client.query(
        `
        UPDATE accounts
        SET balance_paise = balance_paise - $1, version = version + 1, updated_at = now()
        WHERE id = $2;
        `,
        [req.amountPaise.toString(), sourceAccount.id]
      );

      await client.query(
        `
        UPDATE accounts
        SET balance_paise = balance_paise + $1, version = version + 1, updated_at = now()
        WHERE id = $2;
        `,
        [req.amountPaise.toString(), destAccount.id]
      );

      // 10. Transition Transaction to POSTED
      const postedRes = await client.query(
        `
        UPDATE financial_transactions
        SET status = 'POSTED', posted_at = now()
        WHERE id = $1
        RETURNING posted_at;
        `,
        [transactionId]
      );

      // 11. Record Audit Event
      await AuditService.logWithClient(client, {
        actorUserId: userId,
        eventType: 'FINANCIAL_TRANSFER_COMPLETED',
        resourceType: 'TRANSACTION',
        resourceId: transactionId,
        outcome: 'SUCCESS',
        ipAddress: clientIp,
        userAgent: userAgent,
        details: {
          transactionRef: txRef,
          amountPaise: req.amountPaise.toString(),
          sourceAccountId: sourceAccount.id,
          destinationAccountId: destAccount.id,
        },
      });

      const responsePayload = {
        transactionRef: txRef,
        status: 'POSTED',
        amountPaise: req.amountPaise.toString(),
        currency: 'INR',
        postedAt: postedRes.rows[0].posted_at,
      };

      // 12. Finalize Idempotency Record
      if (req.idempotencyKey && isIdempotencyLocked) {
        await IdempotencyService.completeRecord(
          client,
          userId,
          req.idempotencyKey,
          transactionId,
          200,
          responsePayload
        );
      }

      // 13. Commit (Triggers deferred double-entry validation!)
      await client.query('COMMIT;');

      return { isReplay: false, data: responsePayload };
    } catch (error) {
      await client.query('ROLLBACK;').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * ATOMIC CASH / CLEARING DEPOSIT
   */
  static async deposit(userId: string, req: DepositRequest, userRole: string, clientIp?: string, userAgent?: string) {
    if (req.amountPaise <= BigInt(0)) {
      throw { status: 400, code: 'INVALID_AMOUNT', message: 'Deposit amount must be strictly greater than zero.' };
    }

    const client = await pool.connect();
    let isIdempotencyLocked = false;
    const requestHash = IdempotencyService.hashPayload({
      type: 'DEPOSIT',
      destinationAccountId: req.destinationAccountId,
      amountPaise: req.amountPaise.toString(),
    });

    try {
      await client.query('BEGIN;');

      if (req.idempotencyKey) {
        const idempResult = await IdempotencyService.lockOrCreateRecord(
          client,
          userId,
          req.idempotencyKey,
          requestHash
        );
        if (idempResult.action === 'REPLAY') {
          await client.query('COMMIT;');
          return { isReplay: true, data: idempResult.cachedBody };
        }
        if (idempResult.action === 'CONFLICT') {
          throw { status: 409, code: 'CONCURRENT_REQUEST', message: 'A deposit request with this key is already in progress.' };
        }
        if (idempResult.action === 'PAYLOAD_MISMATCH') {
          throw { status: 422, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'Idempotency key reused with different payload.' };
        }
        isIdempotencyLocked = true;
      }

      // Lock destination customer account
      const destRes = await client.query(
        `SELECT id, account_number, owner_user_id, status, balance_paise FROM accounts WHERE id = $1 FOR UPDATE;`,
        [req.destinationAccountId]
      );
      if (destRes.rows.length === 0) {
        throw { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Destination account not found.' };
      }
      const destAccount = destRes.rows[0];

      if (destAccount.status !== 'ACTIVE') {
        throw { status: 400, code: 'ACCOUNT_INACTIVE', message: `Destination account is ${destAccount.status}.` };
      }

      // Lock system clearing reserve account
      const systemAccount = await this.getSystemReserveAccount(client);

      const txRef = `TX-DEP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Insert DEPOSIT transaction (source is null per constraint ck_transactions_accounts)
      const txRes = await client.query(
        `
        INSERT INTO financial_transactions (
          transaction_ref, transaction_type, status, amount_paise, currency,
          source_account_id, destination_account_id, initiated_by_user_id, description
        ) VALUES ($1, 'DEPOSIT', 'PENDING', $2, 'INR', NULL, $3, $4, $5)
        RETURNING id;
        `,
        [txRef, req.amountPaise.toString(), destAccount.id, userId, req.description || 'Customer Cash Deposit']
      );
      const transactionId = txRes.rows[0].id;

      // Balanced ledger entries: System reserve DEBIT, Customer account CREDIT
      await client.query(
        `
        INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
        VALUES
          ($1, $2, 'DEBIT', $3, 'INR'),
          ($1, $4, 'CREDIT', $3, 'INR');
        `,
        [transactionId, systemAccount.id, req.amountPaise.toString(), destAccount.id]
      );

      // Update operational balances
      await client.query(
        `UPDATE accounts SET balance_paise = balance_paise + $1, version = version + 1, updated_at = now() WHERE id = $2;`,
        [req.amountPaise.toString(), destAccount.id]
      );

      // Transition to POSTED
      const postedRes = await client.query(
        `UPDATE financial_transactions SET status = 'POSTED', posted_at = now() WHERE id = $1 RETURNING posted_at;`,
        [transactionId]
      );

      await AuditService.logWithClient(client, {
        actorUserId: userId,
        eventType: 'FINANCIAL_DEPOSIT_COMPLETED',
        resourceType: 'TRANSACTION',
        resourceId: transactionId,
        outcome: 'SUCCESS',
        ipAddress: clientIp,
        userAgent: userAgent,
        details: { transactionRef: txRef, amountPaise: req.amountPaise.toString(), destinationAccountId: destAccount.id },
      });

      const responsePayload = {
        transactionId,
        transactionRef: txRef,
        status: 'POSTED',
        amountPaise: req.amountPaise.toString(),
        currency: 'INR',
        destinationAccountId: destAccount.id,
        postedAt: postedRes.rows[0].posted_at,
      };

      if (req.idempotencyKey && isIdempotencyLocked) {
        await IdempotencyService.completeRecord(client, userId, req.idempotencyKey, transactionId, 200, responsePayload);
      }

      await client.query('COMMIT;');
      return { isReplay: false, data: responsePayload };
    } catch (error) {
      await client.query('ROLLBACK;').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * ATOMIC CASH WITHDRAWAL
   */
  static async withdraw(userId: string, req: WithdrawalRequest, userRole: string, clientIp?: string, userAgent?: string) {
    if (req.amountPaise <= BigInt(0)) {
      throw { status: 400, code: 'INVALID_AMOUNT', message: 'Withdrawal amount must be strictly greater than zero.' };
    }

    const client = await pool.connect();
    let isIdempotencyLocked = false;
    const requestHash = IdempotencyService.hashPayload({
      type: 'WITHDRAWAL',
      sourceAccountId: req.sourceAccountId,
      amountPaise: req.amountPaise.toString(),
    });

    try {
      await client.query('BEGIN;');

      if (req.idempotencyKey) {
        const idempResult = await IdempotencyService.lockOrCreateRecord(
          client,
          userId,
          req.idempotencyKey,
          requestHash
        );
        if (idempResult.action === 'REPLAY') {
          await client.query('COMMIT;');
          return { isReplay: true, data: idempResult.cachedBody };
        }
        if (idempResult.action === 'CONFLICT') {
          throw { status: 409, code: 'CONCURRENT_REQUEST', message: 'A withdrawal request with this key is already in progress.' };
        }
        if (idempResult.action === 'PAYLOAD_MISMATCH') {
          throw { status: 422, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'Idempotency key reused with different payload.' };
        }
        isIdempotencyLocked = true;
      }

      // Lock source customer account
      const sourceRes = await client.query(
        `SELECT id, account_number, owner_user_id, account_type, status, balance_paise FROM accounts WHERE id = $1 FOR UPDATE;`,
        [req.sourceAccountId]
      );
      if (sourceRes.rows.length === 0) {
        throw { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Source account not found.' };
      }
      const sourceAccount = sourceRes.rows[0];

      if (userRole !== 'ADMIN' && sourceAccount.owner_user_id !== userId) {
        throw { status: 403, code: 'UNAUTHORIZED_ACCOUNT_ACCESS', message: 'You do not own the source account.' };
      }

      if (sourceAccount.status !== 'ACTIVE') {
        throw { status: 400, code: 'ACCOUNT_INACTIVE', message: `Source account is ${sourceAccount.status}.` };
      }

      // Overdraft prevention
      const currentBalance = BigInt(sourceAccount.balance_paise);
      if (sourceAccount.account_type === 'CUSTOMER' && currentBalance < req.amountPaise) {
        throw {
          status: 400,
          code: 'INSUFFICIENT_FUNDS',
          message: `Insufficient funds for withdrawal. Available: ${currentBalance} paise, Required: ${req.amountPaise} paise.`,
        };
      }

      // Lock system clearing reserve account
      const systemAccount = await this.getSystemReserveAccount(client);

      const txRef = `TX-WTH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Insert WITHDRAWAL transaction (destination is null per constraint ck_transactions_accounts)
      const txRes = await client.query(
        `
        INSERT INTO financial_transactions (
          transaction_ref, transaction_type, status, amount_paise, currency,
          source_account_id, destination_account_id, initiated_by_user_id, description
        ) VALUES ($1, 'WITHDRAWAL', 'PENDING', $2, 'INR', $3, NULL, $4, $5)
        RETURNING id;
        `,
        [txRef, req.amountPaise.toString(), sourceAccount.id, userId, req.description || 'Customer Cash Withdrawal']
      );
      const transactionId = txRes.rows[0].id;

      // Balanced ledger entries: Customer account DEBIT, System reserve CREDIT
      await client.query(
        `
        INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_paise, currency)
        VALUES
          ($1, $2, 'DEBIT', $3, 'INR'),
          ($1, $4, 'CREDIT', $3, 'INR');
        `,
        [transactionId, sourceAccount.id, req.amountPaise.toString(), systemAccount.id]
      );

      // Update operational balances
      await client.query(
        `UPDATE accounts SET balance_paise = balance_paise - $1, version = version + 1, updated_at = now() WHERE id = $2;`,
        [req.amountPaise.toString(), sourceAccount.id]
      );

      // Transition to POSTED
      const postedRes = await client.query(
        `UPDATE financial_transactions SET status = 'POSTED', posted_at = now() WHERE id = $1 RETURNING posted_at;`,
        [transactionId]
      );

      await AuditService.logWithClient(client, {
        actorUserId: userId,
        eventType: 'FINANCIAL_WITHDRAWAL_COMPLETED',
        resourceType: 'TRANSACTION',
        resourceId: transactionId,
        outcome: 'SUCCESS',
        ipAddress: clientIp,
        userAgent: userAgent,
        details: { transactionRef: txRef, amountPaise: req.amountPaise.toString(), sourceAccountId: sourceAccount.id },
      });

      const responsePayload = {
        transactionId,
        transactionRef: txRef,
        status: 'POSTED',
        amountPaise: req.amountPaise.toString(),
        currency: 'INR',
        sourceAccountId: sourceAccount.id,
        postedAt: postedRes.rows[0].posted_at,
      };

      if (req.idempotencyKey && isIdempotencyLocked) {
        await IdempotencyService.completeRecord(client, userId, req.idempotencyKey, transactionId, 200, responsePayload);
      }

      await client.query('COMMIT;');
      return { isReplay: false, data: responsePayload };
    } catch (error) {
      await client.query('ROLLBACK;').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch transaction history for user accounts or administrative audit
   */
  static async getTransactionHistory(params: {
    userId?: string;
    accountId?: string;
    userRole: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const whereClause: any = {};

    if (params.userRole === 'ACCOUNT_HOLDER') {
      if (!params.userId) throw new Error('User ID required');
      whereClause.OR = [
        { sourceAccount: { ownerUserId: params.userId } },
        { destinationAccount: { ownerUserId: params.userId } },
        { initiatedByUserId: params.userId },
      ];
    }

    if (params.accountId) {
      whereClause.OR = [
        { sourceAccountId: params.accountId },
        { destinationAccountId: params.accountId },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: whereClause,
        include: {
          sourceAccount: { select: { id: true, accountNumber: true, accountType: true } },
          destinationAccount: { select: { id: true, accountNumber: true, accountType: true } },
          ledgerEntries: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.financialTransaction.count({ where: whereClause }),
    ]);

    // Format BigInt values for JSON transport
    const formatted = transactions.map((tx: any) => ({
      ...tx,
      amountPaise: tx.amountPaise.toString(),
      ledgerEntries: tx.ledgerEntries.map((le: any) => ({
        ...le,
        amountPaise: le.amountPaise.toString(),
      })),
    }));

    return {
      transactions: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Fetch single transaction detail with double-entry ledger verification
   */
  static async getTransactionById(transactionId: string, userId: string, userRole: string) {
    const tx = await prisma.financialTransaction.findUnique({
      where: { id: transactionId },
      include: {
        sourceAccount: true,
        destinationAccount: true,
        initiatedByUser: { select: { id: true, fullName: true, email: true } },
        ledgerEntries: { include: { account: { select: { id: true, accountNumber: true, accountType: true } } } },
      },
    });

    if (!tx) {
      throw { status: 404, code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found.' };
    }

    // Role check: Customer can only view transactions they are part of
    if (userRole === 'ACCOUNT_HOLDER') {
      const isOwner =
        tx.sourceAccount?.ownerUserId === userId ||
        tx.destinationAccount?.ownerUserId === userId ||
        tx.initiatedByUserId === userId;

      if (!isOwner) {
        throw { status: 403, code: 'FORBIDDEN', message: 'You are not authorized to view this transaction.' };
      }
    }

    return {
      ...tx,
      amountPaise: tx.amountPaise.toString(),
      sourceAccount: tx.sourceAccount ? { ...tx.sourceAccount, balancePaise: tx.sourceAccount.balancePaise.toString(), version: tx.sourceAccount.version.toString() } : null,
      destinationAccount: tx.destinationAccount ? { ...tx.destinationAccount, balancePaise: tx.destinationAccount.balancePaise.toString(), version: tx.destinationAccount.version.toString() } : null,
      ledgerEntries: tx.ledgerEntries.map((e: any) => ({
        ...e,
        amountPaise: e.amountPaise.toString(),
      })),
    };
  }
}
