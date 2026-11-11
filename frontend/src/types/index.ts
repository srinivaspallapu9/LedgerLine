export type UserRole = 'ADMIN' | 'ACCOUNT_HOLDER' | 'AUDITOR';
export type AccountType = 'CUSTOMER' | 'SYSTEM';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type TransactionType = 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL';
export type TransactionStatus = 'PENDING' | 'POSTED' | 'FAILED' | 'REVERSED';
export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isEnabled: boolean;
  createdAt?: string;
}

export interface Account {
  id: string;
  accountNumber: string;
  ownerUserId: string | null;
  accountType: AccountType;
  status: AccountStatus;
  currency: string;
  balancePaise: string;
  version: string;
  createdAt: string;
  owner?: {
    id: string;
    fullName: string;
    email: string;
  };
  reconciliation?: {
    operationalBalancePaise: string;
    ledgerCreditsPaise: string;
    ledgerDebitsPaise: string;
    ledgerNetPaise: string;
    isReconciled: boolean;
  };
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  direction: EntryDirection;
  amountPaise: string;
  currency: string;
  createdAt: string;
  account?: {
    id: string;
    accountNumber: string;
    accountType: AccountType;
  };
}

export interface FinancialTransaction {
  id: string;
  transactionRef: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  amountPaise: string;
  currency: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  initiatedByUserId: string | null;
  description: string | null;
  failureCode: string | null;
  createdAt: string;
  postedAt: string | null;
  sourceAccount?: { id: string; accountNumber: string; accountType: AccountType };
  destinationAccount?: { id: string; accountNumber: string; accountType: AccountType };
  ledgerEntries?: LedgerEntry[];
  initiatedByUser?: { id: string; fullName: string; email: string };
}

export interface SystemMetrics {
  totalUsers: number;
  totalAccounts: number;
  activeAccounts: number;
  totalTransactions: number;
  postedTransactions: number;
  ledgerEntriesCount: number;
  customerDepositBasePaise: string;
  customerDepositBaseINR: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  details: Record<string, any>;
  occurredAt: string;
  actorUser?: {
    id: string;
    fullName: string;
    email: string;
    role: UserRole;
  };
}

