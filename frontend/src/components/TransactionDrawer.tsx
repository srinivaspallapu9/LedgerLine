import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { FinancialTransaction } from '../types';
import { formatPaiseToINR } from '../services/api';
import { AmountDisplay, StatusBadge, formatIST } from './BankingUI';

export function TransactionDrawer({
  transaction,
  onClose,
}: {
  transaction: FinancialTransaction | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!transaction) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transaction, onClose]);

  if (!transaction) return null;

  const debitEntries = transaction.ledgerEntries?.filter((entry) => entry.direction === 'DEBIT') || [];
  const creditEntries = transaction.ledgerEntries?.filter((entry) => entry.direction === 'CREDIT') || [];
  const debitTotal = debitEntries.reduce((total, entry) => total + BigInt(entry.amountPaise), 0n);
  const creditTotal = creditEntries.reduce((total, entry) => total + BigInt(entry.amountPaise), 0n);
  const isBalanced = transaction.status === 'POSTED'
    && debitEntries.length > 0
    && creditEntries.length > 0
    && debitTotal === creditTotal
    && debitTotal === BigInt(transaction.amountPaise);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="transaction-drawer" role="dialog" aria-modal="true" aria-labelledby="transaction-drawer-title">
        <div className="drawer-header">
          <div>
            <StatusBadge status={transaction.status} />
            <h2 id="transaction-drawer-title">Transaction details</h2>
            <p className="drawer-reference">{transaction.transactionRef}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close transaction details">
            <X size={19} />
          </button>
        </div>

        <div className="drawer-summary">
          <div className="drawer-amount">{formatPaiseToINR(transaction.amountPaise)}</div>
          <dl>
            <div><dt>Type</dt><dd>{transaction.transactionType}</dd></div>
            <div><dt>Settlement ID</dt><dd className="font-mono">{transaction.id}</dd></div>
            <div><dt>Amount in paise</dt><dd className="font-mono">{transaction.amountPaise}</dd></div>
            <div><dt>Created</dt><dd>{formatIST(transaction.createdAt)}</dd></div>
            <div><dt>Posted</dt><dd>{transaction.postedAt ? formatIST(transaction.postedAt) : 'Not posted'}</dd></div>
            {transaction.description && <div><dt>Description</dt><dd>{transaction.description}</dd></div>}
          </dl>
        </div>

        <section className="drawer-ledger" aria-labelledby="drawer-ledger-heading">
          <div className="drawer-section-heading">
            <div>
              <span className="section-kicker">LEDGER POSTING</span>
              <h3 id="drawer-ledger-heading">Double-entry records</h3>
            </div>
            <StatusBadge status={isBalanced ? 'Balanced' : transaction.status === 'POSTED' ? 'Review' : 'Not posted'} />
          </div>
          <div className="ledger-columns">
            {[
              { label: 'Debits', entries: debitEntries, direction: 'DEBIT' },
              { label: 'Credits', entries: creditEntries, direction: 'CREDIT' },
            ].map(({ label, entries, direction }) => (
              <div className="ledger-column" key={direction}>
                <h4>{label}</h4>
                {entries.length === 0 ? (
                  <p className="ledger-empty">No {label.toLowerCase()} posted</p>
                ) : entries.map((entry) => (
                  <div className="ledger-entry" key={entry.id}>
                    <div className="ledger-entry-account">
                      <span className="font-mono">{entry.account?.accountNumber || entry.accountId}</span>
                      <small>{entry.account?.accountType || 'Account'} · {entry.amountPaise} paise</small>
                    </div>
                    <AmountDisplay value={formatPaiseToINR(entry.amountPaise)} tone={direction === 'CREDIT' ? 'credit' : 'debit'} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
