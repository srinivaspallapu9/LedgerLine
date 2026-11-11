import React, { useState, useEffect } from 'react';
import { FinancialTransaction } from '../types';
import { api, formatPaiseToINR } from '../services/api';
import { ArrowLeftRight, Eye } from 'lucide-react';
import { AlertBanner, EmptyState, PageHeader, SkeletonRows, StatusBadge, formatIST } from '../components/BankingUI';
import { TransactionDrawer } from '../components/TransactionDrawer';

export const TransactionHistoryPage: React.FC = () => {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTransactions({ page, limit: 15 });
      setTransactions(data.transactions);
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to load transaction history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  const viewTransactionDetail = async (txId: string) => {
    try {
      const data = await api.getTransactionById(txId);
      setSelectedTx(data.transaction);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load transaction details.');
    }
  };

  return (
    <div className="page-view transaction-history">
      <PageHeader title="Transaction history" description="Review posted activity and inspect its ledger records." />

      {error && <AlertBanner message={error} onDismiss={() => setError(null)} />}

      <div className="card">
        {isLoading ? (
          <div className="table-container"><table><tbody><SkeletonRows columns={8} rows={6} /></tbody></table></div>
        ) : transactions.length === 0 && !error ? (
          <EmptyState title="No transactions found" description="When an account transaction is posted, it will appear here." icon={ArrowLeftRight} />
        ) : transactions.length === 0 ? null : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Transaction Ref</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Source Account</th>
                    <th>Destination Account</th>
                    <th>Timestamp</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="font-mono" data-label="Reference" style={{ fontWeight: 600 }}>{tx.transactionRef}</td>
                      <td data-label="Type">
                        <StatusBadge status={tx.transactionType} />
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td data-label="Amount" className="amount-cell" style={{ fontWeight: 700 }}>{formatPaiseToINR(tx.amountPaise)}</td>
                      <td className="font-mono" data-label="Source" style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                        {tx.sourceAccount?.accountNumber || '— (Inflow)'}
                      </td>
                      <td className="font-mono" data-label="Destination" style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                        {tx.destinationAccount?.accountNumber || '— (Outflow)'}
                      </td>
                      <td data-label="Time" style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                        {formatIST(tx.createdAt)}
                      </td>
                      <td data-label="Details">
                        <button
                          onClick={() => viewTransactionDetail(tx.id)}
                          className="btn btn-secondary btn-sm"
                          aria-label={`View ledger details for ${tx.transactionRef}`}
                        >
                          <Eye size={14} /> Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
              <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} records total)
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => loadTransactions(pagination.page - 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Previous
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => loadTransactions(pagination.page + 1)}
                  className="btn btn-secondary btn-sm"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
};
