import { prisma } from '../db/prisma';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';

export class AdminService {
  /**
   * List users with pagination and search
   */
  static async listUsers(params: {
    page?: number;
    limit?: number;
    role?: UserRole;
    isEnabled?: boolean;
    search?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const where: any = {};
    if (params.role) where.role = params.role;
    if (params.isEnabled !== undefined) where.isEnabled = params.isEnabled;
    if (params.search) {
      where.OR = [
        { fullName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isEnabled: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { accounts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Toggle user active/enabled state
   */
  static async setUserStatus(params: {
    targetUserId: string;
    isEnabled: boolean;
    actorUserId: string;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    // Prevent admin from disabling themselves
    if (params.targetUserId === params.actorUserId && !params.isEnabled) {
      throw { status: 400, code: 'CANNOT_DISABLE_SELF', message: 'You cannot disable your own administrator account.' };
    }

    const targetUser = await prisma.user.findUnique({ where: { id: params.targetUserId } });
    if (!targetUser) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }

    const updated = await prisma.user.update({
      where: { id: params.targetUserId },
      data: { isEnabled: params.isEnabled, updatedAt: new Date() },
      select: { id: true, fullName: true, email: true, role: true, isEnabled: true },
    });

    await AuditService.log({
      actorUserId: params.actorUserId,
      eventType: params.isEnabled ? 'USER_ACCOUNT_UNLOCKED' : 'USER_ACCOUNT_LOCKED',
      resourceType: 'USER',
      resourceId: updated.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: { previousState: targetUser.isEnabled, newState: params.isEnabled, reason: params.reason },
    });

    return updated;
  }

  /**
   * Update user authorization role
   */
  static async updateUserRole(params: {
    targetUserId: string;
    newRole: UserRole;
    actorUserId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (params.targetUserId === params.actorUserId) {
      throw { status: 400, code: 'CANNOT_MODIFY_OWN_ROLE', message: 'You cannot change your own administrative role.' };
    }

    const targetUser = await prisma.user.findUnique({ where: { id: params.targetUserId } });
    if (!targetUser) {
      throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }

    const updated = await prisma.user.update({
      where: { id: params.targetUserId },
      data: { role: params.newRole, updatedAt: new Date() },
      select: { id: true, fullName: true, email: true, role: true, isEnabled: true },
    });

    await AuditService.log({
      actorUserId: params.actorUserId,
      eventType: 'USER_ROLE_CHANGED',
      resourceType: 'USER',
      resourceId: updated.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: { oldRole: targetUser.role, newRole: params.newRole },
    });

    return updated;
  }

  /**
   * System-wide financial metrics and dashboard KPIs
   */
  static async getSystemMetrics() {
    const [
      totalUsers,
      totalAccounts,
      activeAccounts,
      totalTransactions,
      postedTransactions,
      ledgerEntriesCount,
      accountsAggregate,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.account.count(),
      prisma.account.count({ where: { status: 'ACTIVE' } }),
      prisma.financialTransaction.count(),
      prisma.financialTransaction.count({ where: { status: 'POSTED' } }),
      prisma.ledgerEntry.count(),
      prisma.account.aggregate({
        _sum: { balancePaise: true },
        where: { accountType: 'CUSTOMER' },
      }),
    ]);

    // Calculate total customer deposits in circulation
    const customerDepositBasePaise = accountsAggregate._sum.balancePaise || BigInt(0);

    return {
      totalUsers,
      totalAccounts,
      activeAccounts,
      totalTransactions,
      postedTransactions,
      ledgerEntriesCount,
      customerDepositBasePaise: customerDepositBasePaise.toString(),
      customerDepositBaseINR: (Number(customerDepositBasePaise) / 100).toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
      }),
    };
  }

  /**
   * Query audit event logs
   */
  static async getAuditLogs(params: {
    page?: number;
    limit?: number;
    actorUserId?: string;
    resourceType?: string;
    outcome?: string;
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 30));
    const offset = (page - 1) * limit;

    const where: any = {};
    if (params.actorUserId) where.actorUserId = params.actorUserId;
    if (params.resourceType) where.resourceType = params.resourceType;
    if (params.outcome) where.outcome = params.outcome;
    if (params.eventType) where.eventType = { contains: params.eventType, mode: 'insensitive' };
    if (params.startDate || params.endDate) {
      where.occurredAt = {};
      if (params.startDate) where.occurredAt.gte = params.startDate;
      if (params.endDate) where.occurredAt.lte = params.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: {
          actorUser: { select: { id: true, fullName: true, email: true, role: true } },
        },
        orderBy: { occurredAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

