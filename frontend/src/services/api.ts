import { User, Account, FinancialTransaction, SystemMetrics, AuditEvent, AccountStatus, UserRole } from '../types';

const API_BASE = '/api';

export function formatPaiseToINR(paiseStr: string | number): string {
  const paise = typeof paiseStr === 'string' ? BigInt(paiseStr || '0') : BigInt(paiseStr);
  const isNegative = paise < BigInt(0);
  const absPaise = isNegative ? -paise : paise;
  const rupees = absPaise / BigInt(100);
  const remainder = absPaise % BigInt(100);
  const formattedRupees = rupees.toLocaleString('en-IN');
  const formattedPaise = remainder.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${formattedPaise}`;
}

export function parseINRToPaise(rupeeAmount: number | string): string {
  const input = String(rupeeAmount).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input);
  if (!match) {
    throw new Error('Enter a positive INR amount with no more than two decimal places.');
  }

  const paise = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
  if (paise <= 0n || paise > 9223372036854775807n) {
    throw new Error('Enter an INR amount within the supported positive range.');
  }
  return paise.toString();
}

export function tryParseINRToPaise(rupeeAmount: number | string): string | null {
  try {
    return parseINRToPaise(rupeeAmount);
  } catch {
    return null;
  }
}

function requireArray<T>(value: unknown, path: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid API response: expected ${path} to be an array.`);
  }
  return value as T[];
}

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('bv_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('bv_token', token);
    } else {
      localStorage.removeItem('bv_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMessage = data?.error?.message || `Request failed with status ${res.status}`;
      const details = data?.error?.details;
      const detailMessage = Array.isArray(details)
        ? details
            .map((issue: any) => {
              const path = Array.isArray(issue.path) && issue.path.length > 0
                ? `${issue.path.join('.')}: `
                : '';
              return `${path}${issue.message || 'Invalid value'}`;
            })
            .join('; ')
        : undefined;
      throw new Error(
        `Request failed (${res.status}${data?.error?.code ? ` ${data.error.code}` : ''}): ${errorMessage}${detailMessage ? ` ${detailMessage}` : ''}`
      );
    }

    return data.data as T;
  }

  // Auth
  async login(credentials: { email: string; password: string }) {
    const data = await this.request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    this.setToken(data.token);
    return data;
  }

  async register(info: { fullName: string; email: string; password: string }) {
    const data = await this.request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(info),
    });
    this.setToken(data.token);
    return data;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this.request<{ user: User }>('/auth/me');
  }

  // Accounts
  async getAccounts() {
    const data = await this.request<{ accounts?: unknown }>('/accounts');
    return { accounts: requireArray<Account>(data?.accounts, 'data.accounts') };
  }

  async getAccountById(id: string) {
    return this.request<{ account: Account }>(`/accounts/${id}`);
  }

  async createAccount(data: { accountType?: string }) {
    return this.request<{ account: Account }>('/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAccountStatus(id: string, status: AccountStatus, reason?: string) {
    return this.request<{ account: Account }>(`/accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  }

  async verifyRecipient(accountNumber: string) {
    return this.request<{
      recipient: {
        displayName: string;
        maskedAccountNumber: string;
        eligible: true;
      };
    }>('/accounts/recipients/verify', {
      method: 'POST',
      body: JSON.stringify({ accountNumber }),
    });
  }

  // Transactions
  async transfer(params: {
    sourceAccountId: string;
    destinationAccountNumber: string;
    amountPaise: string;
    description?: string;
    idempotencyKey?: string;
  }) {
    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return this.request<any>('/transactions/transfer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceAccountId: params.sourceAccountId,
        destinationAccountNumber: params.destinationAccountNumber,
        amountPaise: params.amountPaise,
        description: params.description,
      }),
    });
  }

  async deposit(params: {
    destinationAccountId: string;
    amountPaise: string;
    description?: string;
    idempotencyKey?: string;
  }) {
    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return this.request<any>('/transactions/deposit', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  }

  async withdraw(params: {
    sourceAccountId: string;
    amountPaise: string;
    description?: string;
    idempotencyKey?: string;
  }) {
    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return this.request<any>('/transactions/withdraw', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  }

  async getTransactions(params: { page?: number; limit?: number; accountId?: string } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.accountId) query.set('accountId', params.accountId);

    const data = await this.request<{
      transactions?: unknown;
      pagination?: {
        page?: unknown;
        limit?: unknown;
        total?: unknown;
        totalPages?: unknown;
      };
    }>(`/transactions?${query.toString()}`);
    const transactions = requireArray<FinancialTransaction>(data?.transactions, 'data.transactions');
    const pagination = data?.pagination;
    if (
      !pagination ||
      typeof pagination.page !== 'number' ||
      typeof pagination.limit !== 'number' ||
      typeof pagination.total !== 'number' ||
      typeof pagination.totalPages !== 'number'
    ) {
      throw new Error('Invalid API response: expected transaction pagination metadata.');
    }
    return {
      transactions,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: pagination.totalPages,
      },
    };
  }

  async getTransactionById(id: string) {
    return this.request<{ transaction: FinancialTransaction }>(`/transactions/${id}`);
  }

  // Admin & Auditor
  async getMetrics() {
    return this.request<{ metrics: SystemMetrics }>('/admin/metrics');
  }

  async getAuditLogs(params: { page?: number; limit?: number; eventType?: string; outcome?: string } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.eventType) query.set('eventType', params.eventType);
    if (params.outcome) query.set('outcome', params.outcome);

    return this.request<{
      logs: AuditEvent[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/audit-logs?${query.toString()}`);
  }

  async getUsers(params: { page?: number; limit?: number; search?: string } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', params.page.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.search) query.set('search', params.search);

    return this.request<{
      users: (User & { _count: { accounts: number } })[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/admin/users?${query.toString()}`);
  }

  async updateUserStatus(userId: string, isEnabled: boolean, reason?: string) {
    return this.request<{ user: User }>(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled, reason }),
    });
  }

  async updateUserRole(userId: string, role: UserRole) {
    return this.request<{ user: User }>(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }
}

export const api = new ApiService();
