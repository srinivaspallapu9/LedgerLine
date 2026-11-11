import React, { useState, useEffect } from 'react';
import { SystemMetrics, User, AuditEvent, Account } from '../types';
import { api, formatPaiseToINR } from '../services/api';
import { Activity, Users, Shield, CreditCard, Lock, Unlock, RefreshCw } from 'lucide-react';
import { AlertBanner, EmptyState, PageHeader, SkeletonRows, StatusBadge, formatIST } from '../components/BankingUI';

export const AdminDashboard: React.FC<{ activeTab?: string }> = ({ activeTab = 'overview' }) => {
  const [tab, setTab] = useState<'overview' | 'users' | 'accounts' | 'audit'>(activeTab as any);

  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [users, setUsers] = useState<(User & { _count: { accounts: number } })[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);

  const [searchUser, setSearchUser] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [metricsData, usersData, accountsData, auditData] = await Promise.all([
        api.getMetrics(),
        api.getUsers({ search: searchUser }),
        api.getAccounts(),
        api.getAuditLogs({ limit: 40 }),
      ]);
      setMetrics(metricsData.metrics);
      setUsers(usersData.users);
      setAccounts(accountsData.accounts);
      setAuditLogs(auditData.logs);
    } catch (err: any) {
      setError(err.message || 'Failed to load administrative data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchUser]);

  const toggleUserLock = async (userId: string, currentEnabled: boolean) => {
    const confirm = window.confirm(`Are you sure you want to ${currentEnabled ? 'LOCK' : 'UNLOCK'} this user account?`);
    if (!confirm) return;

    try {
      await api.updateUserStatus(userId, !currentEnabled, 'Admin portal manual status change');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Status update failed');
    }
  };

  const changeUserRole = async (userId: string, newRole: any) => {
    try {
      await api.updateUserRole(userId, newRole);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Role update failed');
    }
  };

  return (
    <div className="page-view admin-dashboard">
      <PageHeader
        title="Administration"
        description="Monitor platform activity, manage access, and inspect system records."
        actions={<button onClick={loadData} className="btn btn-secondary"><RefreshCw size={16} />Refresh data</button>}
      />

      {error && <AlertBanner message={error} onDismiss={() => setError(null)} />}

      {/* Sub-navigation tabs */}
      <div className="section-tabs" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${tab === 'overview' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('overview')}
        >
          <Activity size={14} /> Overview & Reserves
        </button>
        <button
          className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('users')}
        >
          <Users size={14} /> User Governance
        </button>
        <button
          className={`btn ${tab === 'accounts' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('accounts')}
        >
          <CreditCard size={14} /> All Accounts
        </button>
        <button
          className={`btn ${tab === 'audit' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('audit')}
        >
          <Shield size={14} /> Audit Trail
        </button>
      </div>

      {/* TAB 1: OVERVIEW & SYSTEM RESERVES */}
      {tab === 'overview' && isLoading && (
        <div className="stats-grid" aria-label="Loading system metrics">
          {Array.from({ length: 4 }, (_, index) => <div className="stat-card metric-skeleton" key={index}><span className="skeleton-line" /><span className="skeleton-line" /></div>)}
        </div>
      )}

      {tab === 'overview' && metrics && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div>
                <div className="stat-label">Customer Deposit Base</div>
                <div className="stat-value">{metrics.customerDepositBaseINR}</div>
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>{metrics.customerDepositBasePaise} paise</small>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#ecfdf5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CreditCard size={22} />
              </div>
            </div>

            <div className="stat-card">
              <div>
                <div className="stat-label">Posted Transactions</div>
                <div className="stat-value">{metrics.postedTransactions}</div>
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>{metrics.totalTransactions} Total Inceptions</small>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={22} />
              </div>
            </div>

            <div className="stat-card">
              <div>
                <div className="stat-label">Double-Entry Book Size</div>
                <div className="stat-value">{metrics.ledgerEntriesCount}</div>
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>Immutable Journal Entries</small>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#fef3c7', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={22} />
              </div>
            </div>

            <div className="stat-card">
              <div>
                <div className="stat-label">Registered Users</div>
                <div className="stat-value">{metrics.totalUsers}</div>
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>{metrics.activeAccounts} active accounts</small>
              </div>
              <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#f3e8ff', color: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={22} />
              </div>
            </div>
          </div>

          {/* System Reserve Clearing Accounts */}
          <div className="card">
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>Internal system accounts</h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Liquidity clearing and fee retention accounts (no individual owner)
            </p>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Account Identifier</th>
                    <th>Classification</th>
                    <th>Status</th>
                    <th>Operational Balance</th>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? <SkeletonRows columns={5} rows={3} /> : accounts.filter(a => a.accountType === 'SYSTEM').length === 0 ? (
                    <tr><td colSpan={5}><EmptyState title="No system accounts found" /></td></tr>
                  ) : accounts.filter(a => a.accountType === 'SYSTEM').map((acc) => (
                    <tr key={acc.id}>
                      <td className="font-mono" data-label="Account" style={{ fontWeight: 700 }}>{acc.accountNumber}</td>
                      <td data-label="Classification"><StatusBadge status="SYSTEM" /></td>
                      <td data-label="Status"><StatusBadge status={acc.status} /></td>
                      <td className="amount-cell" data-label="Balance" style={{ fontWeight: 700 }}>{formatPaiseToINR(acc.balancePaise)}</td>
                      <td className="font-mono" data-label="Version">v{acc.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'overview' && !isLoading && !metrics && !error && (
        <EmptyState title="System metrics unavailable" description="Refresh the data to try again." icon={Activity} />
      )}

      {/* TAB 2: USER GOVERNANCE */}
      {tab === 'users' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700 }}>Identity & Role Governance</h3>
            <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '300px', width: '100%' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search user by name or email..."
                aria-label="Search users by name or email"
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
              />
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>User Full Name</th>
                  <th>Email</th>
                  <th>Current Role</th>
                  <th>Status</th>
                  <th>Linked Accounts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
              {isLoading ? <SkeletonRows columns={6} rows={5} /> : users.length === 0 ? (
                <tr><td colSpan={6}><EmptyState title="No users found" description={searchUser ? 'Try another name or email address.' : undefined} icon={Users} /></td></tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name" style={{ fontWeight: 600 }}>{u.fullName}</td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Role">
                    <select
                      className="form-select"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', width: 'auto' }}
                      aria-label={`Role for ${u.fullName}`}
                        value={u.role}
                        onChange={(e) => changeUserRole(u.id, e.target.value)}
                      >
                        <option value="ACCOUNT_HOLDER">ACCOUNT_HOLDER</option>
                        <option value="AUDITOR">AUDITOR</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td data-label="Status"><StatusBadge status={u.isEnabled ? 'ACTIVE' : 'LOCKED'} /></td>
                    <td data-label="Accounts">{u._count?.accounts || 0} accounts</td>
                    <td data-label="Actions">
                      <button
                        onClick={() => toggleUserLock(u.id, u.isEnabled)}
                        className={`btn ${u.isEnabled ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                      >
                        {u.isEnabled ? <Lock size={13} /> : <Unlock size={13} />}
                        {u.isEnabled ? 'Lock User' : 'Unlock'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ALL ACCOUNTS */}
      {tab === 'accounts' && (
        <div className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.25rem' }}>Central Account Registry</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Account Number</th>
                  <th>Holder Name</th>
                  <th>Email</th>
                  <th>Classification</th>
                  <th>Status</th>
                  <th>Balance</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
              {isLoading ? <SkeletonRows columns={7} rows={5} /> : accounts.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No accounts found" icon={CreditCard} /></td></tr>
              ) : accounts.map((acc) => (
                <tr key={acc.id}>
                  <td className="font-mono" data-label="Account number" style={{ fontWeight: 600 }}>{acc.accountNumber}</td>
                  <td data-label="Holder">{acc.owner?.fullName || 'System Reserve Entity'}</td>
                  <td data-label="Email">{acc.owner?.email || 'internal@system'}</td>
                  <td data-label="Classification"><StatusBadge status={acc.accountType} /></td>
                  <td data-label="Status"><StatusBadge status={acc.status} /></td>
                  <td className="amount-cell" data-label="Balance" style={{ fontWeight: 700 }}>{formatPaiseToINR(acc.balancePaise)}</td>
                  <td className="font-mono" data-label="Version">v{acc.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT TRAIL */}
      {tab === 'audit' && (
        <div className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.25rem' }}>Security & Audit Event Stream</h3>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
            Immutable append-only security logs protecting authentication and financial integrity
          </p>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>Resource</th>
                  <th>IP Address</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
              {isLoading ? <SkeletonRows columns={7} rows={5} /> : auditLogs.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No audit events found" icon={Shield} /></td></tr>
              ) : auditLogs.map((log) => (
                <tr key={log.id}>
                  <td data-label="Time" style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {formatIST(log.occurredAt)}
                  </td>
                  <td className="font-mono" data-label="Event" style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{log.eventType}</td>
                  <td data-label="Actor">{log.actorUser?.email || 'System'}</td>
                  <td data-label="Outcome">
                    <span className={`badge ${log.outcome === 'SUCCESS' ? 'badge-success' : log.outcome === 'FAILURE' ? 'badge-danger' : 'badge-warning'}`}>
                      {log.outcome}
                    </span>
                  </td>
                  <td data-label="Resource">{log.resourceType}</td>
                  <td className="font-mono" data-label="IP address" style={{ fontSize: '0.75rem' }}>{log.ipAddress || '—'}</td>
                  <td data-label="Details" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {JSON.stringify(log.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
