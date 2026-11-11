import { prisma } from '../db/prisma';
import { PoolClient } from 'pg';

export interface AuditParams {
  actorUserId?: string | null;
  eventType: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, any>;
}

export class AuditService {
  /**
   * Log an audit event using Prisma (standard async flow)
   */
  static async log(params: AuditParams): Promise<void> {
    try {
      const sanitizedDetails = this.sanitize(params.details || {});
      await prisma.auditEvent.create({
        data: {
          actorUserId: params.actorUserId || null,
          eventType: params.eventType,
          resourceType: params.resourceType,
          resourceId: params.resourceId || null,
          outcome: params.outcome,
          correlationId: params.correlationId || null,
          ipAddress: params.ipAddress || null,
          userAgent: params.userAgent ? params.userAgent.substring(0, 500) : null,
          details: sanitizedDetails,
        },
      });
    } catch (error) {
      console.error('[AuditService] Failed to record audit event:', error);
    }
  }

  /**
   * Log an audit event inside an active SQL transaction (for atomic commits)
   */
  static async logWithClient(client: PoolClient, params: AuditParams): Promise<void> {
    const sanitizedDetails = JSON.stringify(this.sanitize(params.details || {}));
    await client.query(
      `
      INSERT INTO audit_events (
        actor_user_id, event_type, resource_type, resource_id, outcome,
        correlation_id, ip_address, user_agent, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb);
      `,
      [
        params.actorUserId || null,
        params.eventType,
        params.resourceType,
        params.resourceId || null,
        params.outcome,
        params.correlationId || null,
        params.ipAddress || null,
        params.userAgent ? params.userAgent.substring(0, 500) : null,
        sanitizedDetails,
      ]
    );
  }

  /**
   * Remove sensitive fields such as passwords, tokens, API keys
   */
  private static sanitize(obj: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'passwordHash', 'password_hash', 'token', 'secret', 'authorization', 'apiKey'];
    const clean: Record<string, any> = {};

    for (const [key, val] of Object.entries(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        clean[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        clean[key] = this.sanitize(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }
}

