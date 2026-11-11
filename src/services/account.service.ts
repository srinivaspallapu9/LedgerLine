import { prisma } from '../db/prisma';
import { AccountStatus, AccountType } from '@prisma/client';
import { AuditService } from './audit.service';

interface RecipientAccount {
  accountNumber: string;
  status: AccountStatus;
  accountType: AccountType;
  ownerUserId: string | null;
  owner: { fullName: string; isEnabled: boolean } | null;
}

type RecipientLookup = (accountNumber: string) => Promise<RecipientAccount | null>;

export async function verifyRecipientAccount(
  accountNumber: string,
  findRecipient: RecipientLookup = (normalizedAccountNumber) =>
    prisma.account.findUnique({
      where: { accountNumber: normalizedAccountNumber },
      select: {
        accountNumber: true,
        status: true,
        accountType: true,
        ownerUserId: true,
        owner: { select: { fullName: true, isEnabled: true } },
      },
    }),
) {
  const normalizedAccountNumber = accountNumber.trim().toUpperCase();
  const account = await findRecipient(normalizedAccountNumber);
  if (
    !account ||
    account.accountType !== AccountType.CUSTOMER ||
    account.status !== AccountStatus.ACTIVE ||
    !account.ownerUserId ||
    !account.owner?.isEnabled
  ) {
    throw {
      status: 404,
      code: 'RECIPIENT_NOT_ELIGIBLE',
      message: 'Recipient account could not be verified. Check the account number and try again.',
    };
  }

  const suffix = account.accountNumber.slice(-2);
  return {
    displayName: account.owner.fullName,
    maskedAccountNumber: `BV-IN-******${suffix}`,
    eligible: true as const,
  };
}

export class AccountService {
  static async verifyRecipient(accountNumber: string) {
    return verifyRecipientAccount(accountNumber);
  }

  /**
   * Create a new customer account
   */
  static async createAccount(params: {
    userId: string;
    accountType?: AccountType;
    actorUserId: string;
    actorRole: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    // If not admin, user can only open account for themselves
    if (params.actorRole !== 'ADMIN' && params.actorUserId !== params.userId) {
      throw { status: 403, code: 'FORBIDDEN', message: 'You can only create accounts for yourself.' };
    }

    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const accountNumber = `BV-IN-${randomSuffix}`;

    const account = await prisma.account.create({
      data: {
        accountNumber,
        ownerUserId: params.userId,
        accountType: params.accountType || AccountType.CUSTOMER,
        status: AccountStatus.ACTIVE,
        currency: 'INR',
        balancePaise: BigInt(0),
        version: BigInt(0),
      },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
      },
    });

    await AuditService.log({
      actorUserId: params.actorUserId,
      eventType: 'ACCOUNT_OPENED',
      resourceType: 'ACCOUNT',
      resourceId: account.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: { accountNumber: account.accountNumber, ownerUserId: params.userId },
    });

    return {
      ...account,
      balancePaise: account.balancePaise.toString(),
      version: account.version.toString(),
    };
  }

  /**
   * Get accounts belonging to a specific user
   */
  static async getUserAccounts(userId: string) {
    const accounts = await prisma.account.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((acc) => ({
      ...acc,
      balancePaise: acc.balancePaise.toString(),
      version: acc.version.toString(),
    }));
  }

  /**
   * Get all accounts (for ADMIN and AUDITOR)
   */
  static async getAllAccounts(params: {
    page?: number;
    limit?: number;
    status?: AccountStatus;
    type?: AccountType;
    search?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = (page - 1) * limit;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.type) where.accountType = params.type;
    if (params.search) {
      where.OR = [
        { accountNumber: { contains: params.search, mode: 'insensitive' } },
        { owner: { fullName: { contains: params.search, mode: 'insensitive' } } },
        { owner: { email: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        where,
        include: {
          owner: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.account.count({ where }),
    ]);

    return {
      accounts: accounts.map((acc) => ({
        ...acc,
        balancePaise: acc.balancePaise.toString(),
        version: acc.version.toString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get account detail by ID with ownership verification
   */
  static async getAccountById(accountId: string, userId: string, userRole: string) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!account) {
      throw { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' };
    }

    if (userRole === 'ACCOUNT_HOLDER' && account.ownerUserId !== userId) {
      throw { status: 403, code: 'FORBIDDEN', message: 'You are not authorized to view this account.' };
    }

    // Ledger balance reconciliation
    const ledgerStats = await prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId },
      _sum: { amountPaise: true },
    });

    let debits = BigInt(0);
    let credits = BigInt(0);
    for (const stat of ledgerStats) {
      if (stat.direction === 'DEBIT') debits = stat._sum.amountPaise || BigInt(0);
      if (stat.direction === 'CREDIT') credits = stat._sum.amountPaise || BigInt(0);
    }

    // In customer banking: Customer deposits/credits are liabilities (inflow), debits are outflows.
    const ledgerNetBalance = credits - debits;

    return {
      ...account,
      balancePaise: account.balancePaise.toString(),
      version: account.version.toString(),
      reconciliation: {
        operationalBalancePaise: account.balancePaise.toString(),
        ledgerCreditsPaise: credits.toString(),
        ledgerDebitsPaise: debits.toString(),
        ledgerNetPaise: ledgerNetBalance.toString(),
        isReconciled: account.balancePaise === ledgerNetBalance,
      },
    };
  }

  /**
   * Freeze, Activate, or Close Account (Admin only)
   */
  static async updateAccountStatus(params: {
    accountId: string;
    newStatus: AccountStatus;
    actorUserId: string;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const account = await prisma.account.findUnique({ where: { id: params.accountId } });
    if (!account) {
      throw { status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' };
    }

    if (account.status === params.newStatus) {
      return { ...account, balancePaise: account.balancePaise.toString(), version: account.version.toString() };
    }

    // If closing, ensure balance is 0
    if (params.newStatus === AccountStatus.CLOSED && account.balancePaise !== BigInt(0)) {
      throw {
        status: 400,
        code: 'ACCOUNT_BALANCE_NOT_ZERO',
        message: 'Cannot close an account with a nonzero balance. Withdraw or transfer funds first.',
      };
    }

    const updated = await prisma.account.update({
      where: { id: params.accountId },
      data: { status: params.newStatus, updatedAt: new Date() },
    });

    await AuditService.log({
      actorUserId: params.actorUserId,
      eventType: 'ACCOUNT_STATUS_UPDATED',
      resourceType: 'ACCOUNT',
      resourceId: updated.id,
      outcome: 'SUCCESS',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      details: { oldStatus: account.status, newStatus: params.newStatus, reason: params.reason },
    });

    return {
      ...updated,
      balancePaise: updated.balancePaise.toString(),
      version: updated.version.toString(),
    };
  }
}
