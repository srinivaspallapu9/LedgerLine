# THREATS.md — BalanceVault Security and Threat Analysis

## 1. Scope

BalanceVault is a financial transaction simulation application built using React, TypeScript, Node.js, Express, Prisma, and PostgreSQL.

It supports customer accounts, financial transactions, administrative functionality, and auditor access.

This document identifies security threats, intended controls, and verification requirements. It does not claim that every control has been independently penetration-tested.

## 2. Assets to Protect

| Asset | Security Requirement |
|---|---|
| User credentials | Confidentiality |
| Authentication tokens | Confidentiality and integrity |
| Account balances | Integrity |
| Ledger entries | Integrity and traceability |
| Transaction records | Integrity and availability |
| Audit events | Integrity and accountability |
| Customer information | Confidentiality |
| Administrator access | Restricted authorization |
| Auditor access | Read-only authorization |
| Database credentials | Confidentiality |

## 3. Threat Actors

- Unauthenticated external attackers
- Authenticated customers attempting unauthorized access
- Malicious or compromised administrator accounts
- Users attempting to bypass frontend restrictions
- Attackers exploiting leaked credentials or deployment configuration
- Concurrent requests attempting duplicate or invalid transactions

## 4. Trust Boundaries

1. Browser frontend → Backend API
2. Backend API → PostgreSQL database
3. Customer → Customer account data
4. Administrator → Administrative operations
5. Auditor → Read-only financial and audit information
6. Deployment platform → Environment variables and secrets

The frontend is untrusted. Authorization and financial validation must occur on the backend.

## 5. Threats and Mitigations

### T1 — Unauthorized Account Access

**Threat:** A customer attempts to access another customer's account or transaction history.

**Impact:** Confidentiality breach and possible financial abuse.

**Mitigations:**
- Authenticate API requests.
- Enforce account ownership on the backend.
- Avoid trusting account IDs supplied by the browser.
- Validate ownership before returning account or transaction data.

**Verification:** Attempt cross-account access using two different customer accounts.

### T2 — Privilege Escalation

**Threat:** A customer attempts to access administrator or auditor functionality.

**Impact:** Unauthorized administrative access or disclosure of financial information.

**Mitigations:**
- Backend role-based authorization.
- Separate ADMIN, ACCOUNT_HOLDER, and AUDITOR permissions.
- Reject unauthorized requests even if the frontend exposes the relevant URL.
- Do not allow users to assign themselves privileged roles through registration.

**Verification:** Test protected endpoints using customer, auditor, and administrator tokens.

### T3 — Unauthorized Financial Transactions

**Threat:** A customer attempts to debit another account, withdraw excessive funds, or manipulate transaction amounts.

**Impact:** Financial integrity violation.

**Mitigations:**
- Validate account ownership and account status.
- Validate transaction amount.
- Enforce sufficient balance.
- Apply database transactions for financial operations.
- Prevent overdrafts through concurrency-safe balance handling.
- Record ledger entries consistently.

**Verification:** Test insufficient funds, invalid amounts, frozen accounts, and concurrent transfers.

### T4 — Duplicate Transaction Submission

**Threat:** A request is retried or submitted multiple times, creating duplicate financial transactions.

**Impact:** Incorrect balances and duplicate ledger entries.

**Mitigations:**
- Idempotency keys.
- Database uniqueness constraints.
- Transactional processing.
- Consistent handling of repeated requests.

**Verification:** Submit the same idempotency key repeatedly and verify that the financial effect occurs only once.

### T5 — Concurrent Transaction Race Conditions

**Threat:** Multiple requests execute simultaneously against the same account balance.

**Impact:** Overdrafts or inconsistent ledger state.

**Mitigations:**
- Database transactions.
- Appropriate locking or atomic balance updates.
- Database constraints.
- Concurrency-aware transaction processing.

**Verification:** Execute simultaneous withdrawals or transfers against a limited balance and verify that invalid overdrafts cannot occur.

### T6 — Ledger Tampering

**Threat:** A user or administrator attempts to modify or delete posted financial records.

**Impact:** Loss of financial integrity and auditability.

**Mitigations:**
- Restrict ledger mutation permissions.
- Preserve transaction history.
- Use reversal or compensating transactions rather than silently changing posted records.
- Record sensitive operations in audit events.

**Verification:** Confirm that ordinary application endpoints cannot modify or delete posted ledger entries.

### T7 — Audit Log Manipulation

**Threat:** An attacker attempts to erase or alter evidence of sensitive operations.

**Impact:** Reduced accountability and inability to investigate incidents.

**Mitigations:**
- Restrict audit-event access.
- Restrict audit-event modification.
- Record actor, action, and relevant context.
- Separate auditor read permissions from financial mutation permissions.

**Verification:** Attempt unauthorized audit access and mutation through the API.

### T8 — Credential Exposure

**Threat:** Database credentials, JWT secrets, or administrator passwords are exposed through source control or frontend bundles.

**Impact:** Unauthorized database or application access.

**Mitigations:**
- Store secrets in environment variables.
- Keep `.env` excluded from Git.
- Use `.env.example` with placeholders only.
- Never embed backend secrets in frontend environment variables.
- Rotate credentials if exposed.

**Verification:** Inspect Git history, deployment variables, and frontend build output for secrets.

### T9 — Authentication Abuse

**Threat:** Attackers repeatedly submit login requests or attempt credential guessing.

**Impact:** Account compromise or service degradation.

**Mitigations:**
- Password hashing.
- Authentication rate limiting.
- Secure token handling.
- Generic authentication error messages where appropriate.
- Strong administrator password requirements.

**Verification:** Test rate limits and invalid authentication attempts.

### T10 — SQL Injection and Malformed Input

**Threat:** Attackers submit malicious input through API parameters or request bodies.

**Impact:** Unauthorized data access or application failure.

**Mitigations:**
- Prisma parameterized database operations.
- Request validation.
- Avoid unsafe raw SQL.
- Validate IDs, amounts, and request structures.

**Verification:** Test malformed inputs and review raw SQL usage.

### T11 — Auditor Write Access

**Threat:** An auditor attempts to perform financial mutations.

**Impact:** Separation of duties is violated.

**Mitigations:**
- Explicit backend authorization.
- Read-only auditor permissions.
- No reliance on UI restrictions.

**Verification:** Attempt deposits, withdrawals, transfers, account changes, and administrative operations with an auditor token.

## 6. Security Testing Checklist

The following are verification tasks. Mark each complete only after executing and recording the result.

- [ ] Customer cannot read another customer's account.
- [ ] Customer cannot access administrator endpoints.
- [ ] Auditor cannot perform financial mutations.
- [ ] Invalid or insufficient-funds withdrawals are rejected.
- [ ] Duplicate idempotency requests do not duplicate financial effects.
- [ ] Concurrent withdrawals cannot create an overdraft.
- [ ] Posted ledger entries cannot be silently edited or deleted.
- [ ] Unauthorized audit-event access is rejected.
- [ ] Invalid authentication is rejected.
- [ ] Authentication rate limiting is enforced.
- [ ] Database and application secrets are absent from Git.
- [ ] Production API rejects invalid request payloads.
- [ ] Financial ledger entries balance correctly.
- [ ] Transaction rollback leaves no partial financial state.

## 7. Known Limitations

BalanceVault is a hiring-challenge application and financial-system simulation, not a production banking platform.

Potential areas requiring additional work include:

- Independent security review and penetration testing
- Stronger operational monitoring and alerting
- Database backup and recovery testing
- Production-grade secret rotation
- External security audit
- Additional abuse and load testing
- Formal financial reconciliation procedures

## 8. Security Claims

This document distinguishes implemented design controls from verified test results.

A feature must not be described as secure solely because it exists in the source code. Security claims should be supported by code review, automated tests, or recorded manual verification.
