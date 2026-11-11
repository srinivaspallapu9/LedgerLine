import React, { useState, useEffect } from 'react';
import { FinancialTransaction, AuditEvent, SystemMetrics } from '../types';
import { api, formatPaiseToINR } from '../services/api';
import { ShieldCheck, FileCheck, RefreshCw, Eye } from 'lucide-react';
import { AlertBanner, EmptyState, PageHeader, SkeletonRows, StatusBadge, formatIST } from '../components/BankingUI';
import { TransactionDrawer } from '../components/TransactionDrawer';

export const AuditorView: React.FC<{ activeTab?: string }> = ({ activeTab = 'transactions' }) => {
  const [tab, setTab] = useState<'transactions' | 'audit' | 'metrics'>(activeTab as any);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [txData, auditData, metricsData] = await Promise.all([
        api.getTransactions({ limit: 40 }),
        api.getAuditLogs({ limit: 40 }),
        api.getMetrics(),
      ]);
      setTransactions(txData.transactions);
      setAuditLogs(auditData.logs);
      setMetrics(metricsData.metrics);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load auditor records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const viewDetail = async (txId: string) => {
    try {
      const data = await api.getTransactionById(txId);
      setSelectedTx(data.transaction);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load ledger details.');
    }
  };

  return (
    <div className="page-view auditor-view">
      <PageHeader
        title="Ledger examination"
        description="Read-only review of financial journal entries and compliance events."
        actions={<><StatusBadge status="AUDITOR" /><button onClick={loadData} className="btn btn-secondary"><RefreshCw size={16} />Refresh records</button></>}
      />
      {error && <AlertBanner message={error} onDismiss={() => setError(null)} />}

      <div className="section-tabs" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${tab === 'transactions' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('transactions')}
        >
          <FileCheck size={14} /> Ledger Journal Examination
        </button>
        <button
          className={`btn ${tab === 'audit' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={() => setTab('audit')}
        >
          <ShieldCheck size={14} /> Operational Audit Log
        </button>
      </div>

      {tab === 'transactions' && (
        <div className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>Double-Entry General Ledger</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Transaction Ref</th>
                  <th>Classification</th>
                  <th>Amount (INR)</th>
                  <th>Amount (Paise)</th>
                  <th>Source Account</th>
                  <th>Destination Account</th>
                  <th>Settlement State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? <SkeletonRows columns={8} rows={6} /> : transactions.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState title="No ledger transactions" description="No financial transactions are available for this view." icon={FileCheck} /></td></tr>
                ) : transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="font-mono" data-label="Reference" style={{ fontWeight: 600 }}>{tx.transactionRef}</td>
                    <td data-label="Type"><StatusBadge status={tx.transactionType} /></td>
                    <td data-label="INR" className="amount-cell" style={{ fontWeight: 700 }}>{formatPaiseToINR(tx.amountPaise)}</td>
                    <td className="font-mono" data-label="Paise">{tx.amountPaise}</td>
                    <td className="font-mono" data-label="Debit account" style={{ fontSize: '0.8125rem' }}>{tx.sourceAccount?.accountNumber || '—'}</td>
                    <td className="font-mono" data-label="Credit account" style={{ fontSize: '0.8125rem' }}>{tx.destinationAccount?.accountNumber || '—'}</td>
                    <td data-label="Status"><StatusBadge status={tx.status} /></td>
                    <td data-label="Details">
                      <button onClick={() => viewDetail(tx.id)} className="btn btn-secondary btn-sm" aria-label={`Inspect ${tx.transactionRef}`}>
                        <Eye size={13} /> Verify Entries
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>Compliance & Event Audit Trail</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Actor</th>
                  <th>Outcome</th>
                  <th>IP Address</th>
                  <th>Context Details</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? <SkeletonRows columns={6} rows={6} /> : auditLogs.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState title="No audit events" description="No compliance events are available for this view." icon={ShieldCheck} /></td></tr>
                ) : auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td data-label="Time" style={{ fontSize: '0.75rem', color: '#64748b' }}>{formatIST(log.occurredAt)}</td>
                    <td className="font-mono" data-label="Event" style={{ fontWeight: 600 }}>{log.eventType}</td>
                    <td data-label="Actor">{log.actorUser?.email || 'System'}</td>
                    <td data-label="Outcome"><StatusBadge status={log.outcome} /></td>
                    <td className="font-mono" data-label="IP address" style={{ fontSize: '0.75rem' }}>{log.ipAddress || '—'}</td>
                    <td data-label="Context" style={{ fontSize: '0.75rem', color: '#64748b' }}>{JSON.stringify(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
};
