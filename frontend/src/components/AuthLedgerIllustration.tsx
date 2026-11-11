import React from 'react';
import { ShieldCheck } from 'lucide-react';

const ledgerRows = [
  { direction: 'DEBIT', reference: 'TX-TRF-8241', amount: '₹2,500.00' },
  { direction: 'CREDIT', reference: 'TX-TRF-8241', amount: '₹2,500.00' },
];

export function AuthLedgerIllustration() {
  return (
    <section className="auth-ledger" aria-label="Illustration of balanced ledger entries">
      <div className="auth-ledger-heading">
        <div>
          <span className="forest-kicker">POSTED WITH PRECISION</span>
          <h2>Every entry has its counterpart.</h2>
          <p>Each transfer is recorded on both sides of the ledger.</p>
        </div>
        <span className="ledger-lock-mark" aria-hidden="true"><ShieldCheck size={23} /></span>
      </div>
      <div className="ledger-illustration">
        <div className="ledger-illustration-head">
          <span>ENTRY</span><span>REFERENCE</span><span>AMOUNT</span>
        </div>
        {ledgerRows.map((row, index) => (
          <div className="ledger-illustration-row" key={row.direction} style={{ animationDelay: `${index * 600}ms` }}>
            <span className={`ledger-direction ${row.direction.toLowerCase()}`}>{row.direction}</span>
            <span className="font-mono">{row.reference}</span>
            <strong>{row.amount}</strong>
          </div>
        ))}
        <div className="ledger-balanced">
          <svg className="balanced-check" viewBox="0 0 24 24" role="img" aria-label="Balanced">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
          <span>Debits = Credits, Balanced</span>
        </div>
      </div>
      <p className="auth-ledger-caption">Illustrative ledger entry · No account data shown</p>
    </section>
  );
}
