# BalanceVault (formerly LedgerLine) V1 — Migration Verification Report

## 1. Executive Summary

This report documents the verification of the BalanceVault Core Financial Schema implementation on PostgreSQL 18.6 using Prisma ORM and native PostgreSQL constraint engines.

- **Primary Database**: `ledgerline` on `localhost:5432`
- **Isolated Test Database**: `ledgerline_test` on `localhost:5432`
- **Prisma Version**: 6.19.3
- **Test Suite Results**: 36 passed, 0 failed (100% pass rate)

---

## 2. Existing Repository State and Migration Analysis

### Pre-Migration Inspection
1. **Existing SQL Schema**: Flyway migration `V1__create_core_schema.sql` was identified in `backend/ledgerline/src/main/resources/db/migration/`.
2. **Spring Boot Scaffold**: Spring Boot 3.5.6 application with JPA and Flyway was present in `backend/ledgerline/`.
3. **Database State**: PostgreSQL 18.6 was running locally on port 5432 with an empty database `ledgerline`.
4. **Resolution Strategy**:
   - Preserved all existing Spring Boot and Java codebase in `backend/ledgerline/`.
   - Preserved all existing documentation in `doc/`.
   - Implemented Prisma schema (`prisma/schema.prisma`) and Prisma migration (`prisma/migrations/20261110000000_init_core_financial_schema/migration.sql`) at repository root.
   - Preserved and reinforced all PostgreSQL-specific financial integrity mechanisms (deferred constraint triggers, immutability functions, check constraints, partial indexes, and email normalization).

---

## 3. Schema Verification

### 3.1. Tables Verified (`\dt`)
```
 public | _prisma_migrations     | table | postgres
 public | accounts               | table | postgres
 public | audit_events           | table | postgres
 public | financial_transactions | table | postgres
 public | idempotency_records    | table | postgres
 public | ledger_entries         | table | postgres
 public | users                  | table | postgres
```

### 3.2. Enums Verified (`\dT`)
- `account_status` (`ACTIVE`, `FROZEN`, `CLOSED`)
- `account_type` (`CUSTOMER`, `SYSTEM`)
- `entry_direction` (`DEBIT`, `CREDIT`)
- `transaction_status` (`PENDING`, `POSTED`, `FAILED`, `REVERSED`)
- `transaction_type` (`TRANSFER`, `DEPOSIT`, `WITHDRAWAL`)
- `user_role` (`ADMIN`, `ACCOUNT_HOLDER`, `AUDITOR`)

### 3.3. Key Constraints Verified
- `ck_accounts_balance`: `account_type = 'SYSTEM' OR balance_paise >= 0`
- `ck_accounts_owner_type`: `(account_type = 'CUSTOMER' AND owner_user_id IS NOT NULL) OR (account_type = 'SYSTEM' AND owner_user_id IS NULL)`
- `ck_accounts_currency`: `currency = 'INR'`
- `ck_accounts_version`: `version >= 0`
- `uq_accounts_account_number`: Unique account numbers
- `ck_transactions_amount`: `amount_paise > 0`
- `ck_transactions_currency`: `currency = 'INR'`
- `ck_transactions_accounts`: Enforces source/dest rules per transaction type
- `ck_transactions_posted_time`: Enforces non-null posted_at strictly for POSTED
- `ck_transactions_failure_code`: Rejects failure_code for non-FAILED transactions
- `ck_ledger_amount`: `amount_paise > 0`
- `ck_ledger_currency`: `currency = 'INR'`
- `ck_idempotency_state`: `state IN ('IN_PROGRESS', 'COMPLETED')`
- `ck_idempotency_completion`: State machine completion timestamp rules
- `ck_audit_outcome`: `outcome IN ('SUCCESS', 'FAILURE', 'DENIED')`
- `ck_users_email_not_blank`: Rejects empty or whitespace emails
- `ck_users_email_normalized`: Enforces lowercase trimmed email

### 3.4. Triggers Verified (`information_schema.triggers`)
```
 accounts               | trg_accounts_updated_at               | BEFORE | UPDATE
 audit_events           | trg_audit_events_immutable            | BEFORE | DELETE
 audit_events           | trg_audit_events_immutable            | BEFORE | UPDATE
 financial_transactions | ctrg_transaction_balanced_on_status   | AFTER  | UPDATE (DEFERRED)
 financial_transactions | ctrg_transaction_balanced_on_status   | AFTER  | INSERT (DEFERRED)
 ledger_entries         | ctrg_transaction_balanced_on_entries  | AFTER  | INSERT (DEFERRED)
 ledger_entries         | trg_ledger_entries_immutable          | BEFORE | UPDATE
 ledger_entries         | trg_ledger_entries_immutable          | BEFORE | DELETE
 ledger_entries         | trg_ledger_entries_prevent_post_entry | BEFORE | INSERT
 users                  | trg_users_normalize_email             | BEFORE | INSERT
 users                  | trg_users_normalize_email             | BEFORE | UPDATE
 users                  | trg_users_updated_at                  | BEFORE | UPDATE
```

---

## 4. Test Execution Results

All 36 automated integration tests executed against isolated test database `ledgerline_test`:

| # | Test Name | Result | Duration |
|---|---|---|---|
| 1 | All 6 domain tables exist in public schema | PASS | 54ms |
| 2 | All 6 PostgreSQL financial enums exist | PASS | 5ms |
| 3 | Partial index idx_accounts_owner_status exists with WHERE predicate | PASS | 13ms |
| 4 | Foreign keys enforce ON DELETE RESTRICT on financial history | PASS | 6ms |
| 5 | Customer account requires owner_user_id | PASS | 14ms |
| 6 | System account must NOT have owner_user_id | PASS | 34ms |
| 7 | Customer account balance cannot be negative | PASS | 2ms |
| 8 | Account currency must equal INR | PASS | 2ms |
| 9 | Account version cannot be negative | PASS | 2ms |
| 10 | Create valid customer and system accounts | PASS | 13ms |
| 11 | Transaction amount must be strictly greater than zero | PASS | 3ms |
| 12 | TRANSFER requires both source and destination accounts | PASS | 3ms |
| 13 | TRANSFER source and destination accounts must differ | PASS | 3ms |
| 14 | DEPOSIT requires destination account and NO source account | PASS | 3ms |
| 15 | WITHDRAWAL requires source account and NO destination account | PASS | 3ms |
| 16 | POSTED transaction must have non-null posted_at timestamp | PASS | 2ms |
| 17 | Non-POSTED transaction must have NULL posted_at timestamp | PASS | 2ms |
| 18 | POSTED transaction cannot have failure_code | PASS | 3ms |
| 19 | Balanced transaction commits successfully with matching debit and credit | PASS | 34ms |
| 20 | POSTED transaction with ZERO ledger entries fails at commit | PASS | 9ms |
| 21 | POSTED transaction with only ONE ledger entry fails at commit | PASS | 11ms |
| 22 | POSTED transaction with unbalanced DEBIT and CREDIT totals fails at commit | PASS | 7ms |
| 23 | POSTED transaction with only DEBIT entries fails at commit | PASS | 12ms |
| 24 | Inserting ledger entry into already POSTED transaction fails immediately | PASS | 3ms |
| 25 | Setup sample ledger entry and audit event | PASS | 12ms |
| 26 | UPDATE on ledger_entries fails with SQLSTATE 55000 | PASS | 2ms |
| 27 | DELETE on ledger_entries fails with SQLSTATE 55000 | PASS | 2ms |
| 28 | UPDATE on audit_events fails with SQLSTATE 55000 | PASS | 2ms |
| 29 | DELETE on audit_events fails with SQLSTATE 55000 | PASS | 2ms |
| 30 | Initial request records IN_PROGRESS state | PASS | 6ms |
| 31 | Duplicate key with same user fails unique constraint | PASS | 3ms |
| 32 | Different user can safely use the same idempotency key | PASS | 3ms |
| 33 | Idempotency state machine completion constraints enforced | PASS | 3ms |
| 34 | Blank email rejected after trimming | PASS | 3ms |
| 35 | Deleting user with financial history fails (ON DELETE RESTRICT) | PASS | 4ms |
| 36 | Prisma Client can create and load relational models with BigInt | PASS | 858ms |

**Final Verification Summary**: 36 PASSED, 0 FAILED.

