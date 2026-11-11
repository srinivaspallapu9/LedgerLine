import React, { useState, useEffect, useRef } from 'react';
import { Account, FinancialTransaction } from '../types';
import { api, formatPaiseToINR, parseINRToPaise, tryParseINRToPaise } from '../services/api';
import { CreditCard, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Plus, RefreshCw, CheckCircle, Copy, Check } from 'lucide-react';
import { AlertBanner, EmptyState, PageHeader, SkeletonRows, StatusBadge, formatIST } from '../components/BankingUI';

const ACCOUNT_NUMBER_PATTERN = /^BV-IN-\d{8}$/i;

interface VerifiedRecipient {
  displayName: string;
  maskedAccountNumber: string;
  eligible: true;
  accountNumber: string;
}

export const CustomerDashboard: React.FC<{ onViewTransactions: () => void }> = ({ onViewTransactions }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recentTx, setRecentTx] = useState<FinancialTransaction[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Modal states
  const [activeModal, setActiveModal] = useState<'transfer' | 'deposit' | 'withdraw' | 'new-account' | null>(null);

  // Form states
  const [transferSource, setTransferSource] = useState('');
  const [transferDest, setTransferDest] = useState('');
  const [verifiedRecipient, setVerifiedRecipient] = useState<VerifiedRecipient | null>(null);
  const [isVerifyingRecipient, setIsVerifyingRecipient] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [confirmedTransfer, setConfirmedTransfer] = useState(false);
  const [amountRupees, setAmountRupees] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [displayBalancePaise, setDisplayBalancePaise] = useState(0n);
  const balanceAnimatedRef = useRef(false);
  const [copiedAccount, setCopiedAccount] = useState(false);

  const loadDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accData, txData] = await Promise.all([
        api.getAccounts(),
        api.getTransactions({ limit: 5 }),
      ]);
      setAccounts(accData.accounts);
      setRecentTx(txData.transactions);
      if (accData.accounts.length > 0 && !selectedAccount) {
        setSelectedAccount(accData.accounts[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load accounts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const totalPaise = accounts.reduce((acc, curr) => acc + BigInt(curr.balancePaise || '0'), BigInt(0));
  const transferAmountPaise = tryParseINRToPaise(amountRupees);

  useEffect(() => {
    if (isLoading) return;
    if (balanceAnimatedRef.current) {
      setDisplayBalancePaise(totalPaise);
      return;
    }
    balanceAnimatedRef.current = true;
    const target = totalPaise;
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min((now - start) / 600, 1);
      setDisplayBalancePaise(target * BigInt(Math.floor(progress * 1000)) / 1000n);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [isLoading, totalPaise]);

  const copySelectedAccount = async () => {
    if (!selectedAccount) return;
    try {
      await navigator.clipboard.writeText(selectedAccount.accountNumber);
      setCopiedAccount(true);
      window.setTimeout(() => setCopiedAccount(false), 1800);
    } catch {
      setError('Could not copy the account number. Select and copy it manually.');
    }
  };

  const handleOpenAccount = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.createAccount({ accountType: 'CUSTOMER' });
      setSuccessMsg('New INR checking account opened successfully.');
      setActiveModal(null);
      await loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Could not open account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setTransferError(null);
    try {
      const amountPaise = parseINRToPaise(amountRupees);
      const defaultSourceId = accounts.find((account) => account.status === 'ACTIVE')?.id;
      const sourceAccountId = transferSource || defaultSourceId;
      const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
      if (!sourceAccount || sourceAccount.status !== 'ACTIVE') {
        throw new Error('Select an active source account before sending a transfer.');
      }
      const destinationAccountNumber = transferDest.trim().toUpperCase();
      if (!ACCOUNT_NUMBER_PATTERN.test(destinationAccountNumber)) {
        throw new Error('Enter a valid recipient account number, such as BV-IN-92880846.');
      }
      if (!verifiedRecipient || verifiedRecipient.accountNumber !== destinationAccountNumber) {
        throw new Error('Find and verify the recipient account before submitting the transfer.');
      }
      if (!confirmedTransfer) {
        throw new Error('Confirm the recipient and transfer amount before submitting.');
      }
      const idempotencyKey = `idemp_ui_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      await api.transfer({
        sourceAccountId: sourceAccount.id,
        destinationAccountNumber,
        amountPaise,
        description,
        idempotencyKey,
      });

      setSuccessMsg('Transfer completed and balanced in ledger.');
      setActiveModal(null);
      setAmountRupees('');
      setDescription('');
      setTransferDest('');
      setVerifiedRecipient(null);
      setRecipientTouched(false);
      setConfirmedTransfer(false);
      setTransferError(null);
      await loadDashboardData();
    } catch (err: any) {
      const message = err.message || 'Transfer failed';
      setError(message);
      setTransferError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyRecipient = async () => {
    const accountNumber = transferDest.trim().toUpperCase();
    setVerifiedRecipient(null);
    setRecipientTouched(true);
    setConfirmedTransfer(false);
    setRecipientError(null);
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
      setRecipientError('Enter an account number in the format BV-IN-92880846.');
      return;
    }

    setIsVerifyingRecipient(true);
    try {
      const { recipient } = await api.verifyRecipient(accountNumber);
      setVerifiedRecipient({ ...recipient, accountNumber });
    } catch (err: any) {
      setRecipientError(err.message || 'Could not verify this recipient account.');
    } finally {
      setIsVerifyingRecipient(false);
    }
  };

  const updateRecipientAccountNumber = (value: string) => {
    setTransferDest(value.toUpperCase());
    setVerifiedRecipient(null);
    setRecipientTouched(true);
    setConfirmedTransfer(false);
    setRecipientError(null);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const amountPaise = parseINRToPaise(amountRupees);
      const idempotencyKey = `idemp_ui_dep_${Date.now()}`;

      await api.deposit({
        destinationAccountId: selectedAccount?.id || accounts[0]?.id,
        amountPaise,
        description,
        idempotencyKey,
      });

      setSuccessMsg('Deposit finalized. Account credited atomically.');
      setActiveModal(null);
      setAmountRupees('');
      setDescription('');
      await loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Deposit failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const amountPaise = parseINRToPaise(amountRupees);
      const idempotencyKey = `idemp_ui_wth_${Date.now()}`;

      await api.withdraw({
        sourceAccountId: selectedAccount?.id || accounts[0]?.id,
        amountPaise,
        description,
        idempotencyKey,
      });

      setSuccessMsg('Withdrawal posted successfully.');
      setActiveModal(null);
      setAmountRupees('');
      setDescription('');
      await loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-view customer-dashboard">
      <PageHeader
        title="Your accounts"
        description="Review balances and manage your INR accounts."
        actions={
          <>
          <button onClick={() => loadDashboardData()} className="btn btn-secondary" title="Refresh Accounts">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button onClick={() => setActiveModal('new-account')} className="btn btn-secondary">
            <Plus size={16} />
            Open Account
          </button>
          <button onClick={() => {
            setTransferError(null);
            setActiveModal('transfer');
          }} className="btn btn-primary">
            <ArrowLeftRight size={16} />
            Send
          </button>
          </>
        }
      />

      {successMsg && (
        <AlertBanner message={successMsg} tone="success" onDismiss={() => setSuccessMsg(null)} />
      )}

      {error && <AlertBanner message={error} onDismiss={() => setError(null)} />}

      <div className="stats-grid">
        <div className="stat-card balance-hero">
          <div className="stat-label">Total available balance</div>
          <div className="stat-value">{formatPaiseToINR(displayBalancePaise.toString())}</div>
          <small>{accounts.length} INR account{accounts.length === 1 ? '' : 's'} · combined balance</small>
          {selectedAccount && (
            <div className="balance-account">
              <span className="font-mono">{selectedAccount.accountNumber.replace(/\d(?=\d{4})/g, '•')}</span>
              <button
                type="button"
                className="copy-account-button"
                onClick={copySelectedAccount}
                aria-label={copiedAccount ? 'Account number copied' : 'Copy selected account number'}
                title={copiedAccount ? 'Copied' : 'Copy account number'}
              >
                {copiedAccount ? <Check size={15} /> : <Copy size={14} />}
              </button>
            </div>
          )}
          {selectedAccount && (
            <span className="balance-account-hint">
              {copiedAccount ? 'Account number copied' : 'Selected account'}
            </span>
          )}
        </div>

        <div className="stat-card">
          <div>
            <div className="stat-label">Active accounts</div>
            <div className="stat-value">{accounts.filter(a => a.status === 'ACTIVE').length}</div>
            <small>{accounts.length} total account{accounts.length === 1 ? '' : 's'}</small>
          </div>
          <CreditCard className="stat-icon" size={20} aria-hidden="true" />
        </div>

        <div className="stat-card">
          <div>
            <div className="stat-label">Quick actions</div>
            <div className="quick-actions">
              <button onClick={() => setActiveModal('deposit')} className="btn btn-secondary btn-sm quick-action">
                <ArrowDownLeft size={15} /> Deposit
              </button>
              <button onClick={() => setActiveModal('withdraw')} className="btn btn-secondary btn-sm quick-action">
                <ArrowUpRight size={15} /> Withdraw
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <h2>Your accounts</h2>
          <p>Choose an account for deposits and withdrawals.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        {isLoading && Array.from({ length: 2 }, (_, index) => (
          <div className="card account-skeleton" key={`account-skeleton-${index}`} aria-hidden="true">
            <span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" />
          </div>
        ))}
        {!isLoading && !error && accounts.length === 0 && (
          <div className="card"><EmptyState title="No accounts yet" description="Open an account to get started." icon={CreditCard} /></div>
        )}
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className={`card account-card${selectedAccount?.id === acc.id ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selectedAccount?.id === acc.id}
            style={{
              borderColor: selectedAccount?.id === acc.id ? 'var(--primary)' : undefined,
            }}
            onClick={() => setSelectedAccount(acc)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedAccount(acc);
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <span className="font-mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                  {acc.accountNumber}
                </span>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>
                  {acc.accountType} • INR
                </div>
              </div>
              <span className={`badge ${acc.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                {acc.status}
              </span>
            </div>

            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>AVAILABLE BALANCE</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>
                {formatPaiseToINR(acc.balancePaise)}
              </div>
              <div className="font-mono" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {acc.balancePaise} paise • v{acc.version}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <h3>Recent transactions</h3>
            <p>Latest posted account activity.</p>
          </div>
          <button onClick={onViewTransactions} className="btn btn-secondary btn-sm">
            View all transactions
          </button>
        </div>

        {isLoading ? (
          <div className="table-container"><table><tbody><SkeletonRows columns={5} rows={4} /></tbody></table></div>
        ) : recentTx.length === 0 && !error ? (
          <EmptyState title="No transactions yet" description="Deposits, withdrawals, and transfers will appear here." icon={ArrowLeftRight} />
        ) : recentTx.length === 0 ? null : (
          <div className="table-container">
            <table className="transaction-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentTx.map((tx, index) => {
                  const isDebit = accounts.some((account) => account.id === tx.sourceAccountId);
                  return (
                  <tr key={tx.id} style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}>
                    <td className="font-mono" data-label="Reference" style={{ fontWeight: 600 }}>{tx.transactionRef}</td>
                    <td data-label="Type">
                      <StatusBadge status={tx.transactionType} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td data-label="Amount" className="amount-cell" style={{ fontWeight: 700 }}>
                      <span className={`amount-display ${isDebit ? 'amount-debit' : 'amount-credit'}`}>
                        {isDebit ? '−' : '+'}{formatPaiseToINR(tx.amountPaise)}
                      </span>
                    </td>
                    <td data-label="Time" style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                      {formatIST(tx.createdAt)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeModal === 'transfer' && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title">
            <h3 id="transfer-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Send money</h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Instant settlement verified by double-entry ledger triggers.
            </p>

            <form onSubmit={handleTransfer}>
              {transferError && <AlertBanner message={transferError} />}
              <div className="form-group">
                <label className="form-label" htmlFor="transfer-source-account">Source account</label>
                <select
                  id="transfer-source-account"
                  className="form-select"
                  value={transferSource || accounts.find((account) => account.status === 'ACTIVE')?.id}
                  onChange={(e) => {
                    setTransferSource(e.target.value);
                    setConfirmedTransfer(false);
                  }}
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.status !== 'ACTIVE'}>
                      {a.accountNumber} ({formatPaiseToINR(a.balancePaise)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="transfer-recipient-account">Recipient account number</label>
                <input
                  id="transfer-recipient-account"
                  type="text"
                  required
                  className="form-input font-mono"
                  placeholder="e.g. BV-IN-92880846"
                  value={transferDest}
                  autoComplete="off"
                  maxLength={14}
                  disabled={isVerifyingRecipient}
                  onChange={(e) => updateRecipientAccountNumber(e.target.value)}
                  onBlur={() => setRecipientTouched(true)}
                />
                <small style={{ color: '#64748b', fontSize: '0.75rem' }}>
                  Enter the recipient’s account number to verify the account before transferring.
                </small>
                {recipientTouched && transferDest.length > 0 && !ACCOUNT_NUMBER_PATTERN.test(transferDest.trim()) && !recipientError && (
                  <small className="inline-validation error">Use the format BV-IN-92880846.</small>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: '0.5rem' }}
                  onClick={handleVerifyRecipient}
                  disabled={isVerifyingRecipient || !transferDest.trim()}
                >
                  {isVerifyingRecipient ? <><span className="button-spinner" aria-hidden="true" />Verifying…</> : 'Find recipient'}
                </button>
                {recipientError && (
                  <small role="alert" style={{ color: '#b91c1c', display: 'block', marginTop: '0.5rem' }}>
                    {recipientError}
                  </small>
                )}
                {verifiedRecipient && (
                    <div className="recipient-confirmation">
                      <CheckCircle size={18} aria-hidden="true" />
                      <div>
                        <strong>Recipient verified</strong>
                        <div>{verifiedRecipient.displayName}</div>
                        <div className="font-mono">{verifiedRecipient.maskedAccountNumber}</div>
                      </div>
                    </div>
                  )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="transfer-amount">Amount (INR)</label>
                <input
                  id="transfer-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className="form-input"
                  placeholder="e.g. 2500.00"
                  value={amountRupees}
                  onChange={(e) => {
                    setAmountRupees(e.target.value);
                    setConfirmedTransfer(false);
                  }}
                />
                {amountRupees && transferAmountPaise && (
                  <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                    {transferAmountPaise} paise · 1 INR = 100 paise
                  </small>
                )}
                {amountRupees && !transferAmountPaise && (
                  <small style={{ color: '#b91c1c', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                    Enter a positive amount with no more than two decimal places.
                  </small>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="transfer-description">Description (optional)</label>
                <input
                  id="transfer-description"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Rent Payment"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {verifiedRecipient && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={confirmedTransfer}
                    onChange={(e) => setConfirmedTransfer(e.target.checked)}
                    required
                    style={{ marginTop: '0.25rem' }}
                  />
                  <span>
                    I confirm the recipient {verifiedRecipient.displayName} ({verifiedRecipient.maskedAccountNumber})
                    and the transfer amount of {transferAmountPaise
                      ? formatPaiseToINR(transferAmountPaise)
                      : '—'}.
                  </span>
                </label>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" onClick={() => {
                  setActiveModal(null);
                  setVerifiedRecipient(null);
                  setConfirmedTransfer(false);
                }} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !verifiedRecipient || !confirmedTransfer || isVerifyingRecipient}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  {isSubmitting ? <><span className="button-spinner" aria-hidden="true" />Sending transfer…</> : 'Confirm transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEPOSIT MODAL */}
      {activeModal === 'deposit' && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="deposit-dialog-title">
            <h3 id="deposit-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Deposit funds</h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Funds cleared via system reserve clearing account.
            </p>

            <form onSubmit={handleDeposit}>
              <div className="form-group">
                <label className="form-label" htmlFor="deposit-account">Destination account</label>
                <select
                  id="deposit-account"
                  className="form-select"
                  value={selectedAccount?.id || accounts[0]?.id}
                  onChange={(e) => setSelectedAccount(accounts.find(a => a.id === e.target.value) || null)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} ({formatPaiseToINR(a.balancePaise)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="deposit-amount">Deposit amount (INR)</label>
                <input
                  id="deposit-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className="form-input"
                  placeholder="e.g. 10000.00"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="deposit-memo">Deposit memo (optional)</label>
                <input
                  id="deposit-memo"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Direct Cash Inflow"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setActiveModal(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ flex: 1 }}>
                  {isSubmitting ? 'Processing...' : 'Complete Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {activeModal === 'withdraw' && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="withdraw-dialog-title">
            <h3 id="withdraw-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Cash withdrawal</h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.25rem' }}>
              Overdraft prevention strictly blocks withdrawing more than available balance.
            </p>

            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label className="form-label" htmlFor="withdraw-account">Source account</label>
                <select
                  id="withdraw-account"
                  className="form-select"
                  value={selectedAccount?.id || accounts[0]?.id}
                  onChange={(e) => setSelectedAccount(accounts.find(a => a.id === e.target.value) || null)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} ({formatPaiseToINR(a.balancePaise)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="withdraw-amount">Withdrawal amount (INR)</label>
                <input
                  id="withdraw-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className="form-input"
                  placeholder="e.g. 500.00"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="withdraw-memo">Memo (optional)</label>
                <input
                  id="withdraw-memo"
                  type="text"
                  className="form-input"
                  placeholder="e.g. ATM Cash Withdrawal"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setActiveModal(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ flex: 1 }}>
                  {isSubmitting ? 'Processing...' : 'Confirm Withdrawal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW ACCOUNT MODAL */}
      {activeModal === 'new-account' && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="new-account-dialog-title">
            <h3 id="new-account-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Open additional account</h3>
            <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1.5rem' }}>
              Your new INR checking account will be linked to your identity with zero balance.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" onClick={() => setActiveModal(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                Cancel
              </button>
              <button onClick={handleOpenAccount} disabled={isSubmitting} className="btn btn-primary" style={{ flex: 1 }}>
                {isSubmitting ? 'Opening...' : 'Confirm & Open'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
