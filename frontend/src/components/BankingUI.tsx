import React from 'react';
import { AlertCircle, Info, X, type LucideIcon } from 'lucide-react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone =
    ['POSTED', 'ACTIVE', 'SUCCESS', 'CREDIT'].includes(normalized)
      ? 'badge-success'
      : ['FAILED', 'FAILURE', 'REVERSED', 'LOCKED', 'CLOSED', 'FROZEN', 'DEBIT', 'DENIED'].includes(normalized)
        ? 'badge-danger'
        : ['PENDING', 'IN_PROGRESS', 'AUDITOR', 'SYSTEM'].includes(normalized)
          ? 'badge-warning'
          : 'badge-neutral';

  return <span className={`badge ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function AmountDisplay({
  value,
  tone,
}: {
  value: string;
  tone?: 'credit' | 'debit';
}) {
  return (
    <span className={`amount-display${tone ? ` amount-${tone}` : ''}`}>
      {tone === 'credit' ? '+' : tone === 'debit' ? '−' : ''}
      {value}
    </span>
  );
}

export function AlertBanner({
  message,
  tone = 'error',
  onDismiss,
}: {
  message: string;
  tone?: 'error' | 'success' | 'info';
  onDismiss?: () => void;
}) {
  return (
    <div className={`alert-banner alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {tone === 'success' ? (
        <svg className="alert-success-check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      ) : tone === 'info' ? <Info size={17} aria-hidden="true" /> : <AlertCircle size={17} aria-hidden="true" />}
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="alert-dismiss" onClick={onDismiss} aria-label="Dismiss message">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Info,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-icon"><Icon size={19} aria-hidden="true" /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function SkeletonRows({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}><span className="skeleton-line" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function formatIST(value: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
