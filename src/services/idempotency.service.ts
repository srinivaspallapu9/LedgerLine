import crypto from 'crypto';
import { PoolClient } from 'pg';
import { prisma } from '../db/prisma';

export interface IdempotencyCheckResult {
  isReplay: boolean;
  status: number;
  body: any;
}

export class IdempotencyService {
  /**
   * Computes deterministic SHA-256 hash of incoming request payload
   */
  static hashPayload(payload: any): string {
    const serialized = JSON.stringify(payload || {}, Object.keys(payload || {}).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Acquire or verify idempotency record within an active database transaction.
   * Uses PostgreSQL row locking to handle concurrent race conditions safely.
   */
  static async lockOrCreateRecord(
    client: PoolClient,
    userId: string,
    idempotencyKey: string,
    requestHash: string
  ): Promise<{ action: 'PROCEED' | 'REPLAY' | 'CONFLICT' | 'PAYLOAD_MISMATCH'; cachedStatus?: number; cachedBody?: any }> {
    // Check if record exists with row lock
    const existing = await client.query(
      `
      SELECT id, request_hash, state, response_status, response_body
      FROM idempotency_records
      WHERE user_id = $1 AND idempotency_key = $2
      FOR UPDATE;
      `,
      [userId, idempotencyKey]
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];

      if (record.request_hash !== requestHash) {
        return { action: 'PAYLOAD_MISMATCH' };
      }

      if (record.state === 'COMPLETED') {
        return {
          action: 'REPLAY',
          cachedStatus: record.response_status || 200,
          cachedBody: record.response_body,
        };
      }

      // Record is still IN_PROGRESS (concurrent request or unfinalized attempt)
      return { action: 'CONFLICT' };
    }

    // Insert new IN_PROGRESS record
    await client.query(
      `
      INSERT INTO idempotency_records (
        user_id, idempotency_key, request_hash, state, created_at
      ) VALUES ($1, $2, $3, 'IN_PROGRESS', now());
      `,
      [userId, idempotencyKey, requestHash]
    );

    return { action: 'PROCEED' };
  }

  /**
   * Complete the idempotency record with execution results
   */
  static async completeRecord(
    client: PoolClient,
    userId: string,
    idempotencyKey: string,
    transactionId: string | null,
    statusCode: number,
    responseBody: any
  ): Promise<void> {
    await client.query(
      `
      UPDATE idempotency_records
      SET state = 'COMPLETED',
          completed_at = now(),
          transaction_id = $3,
          response_status = $4,
          response_body = $5::jsonb
      WHERE user_id = $1 AND idempotency_key = $2;
      `,
      [userId, idempotencyKey, transactionId, statusCode, JSON.stringify(responseBody)]
    );
  }
}

