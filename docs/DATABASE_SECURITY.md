# BalanceVault (formerly LedgerLine) V1 — Database Security & Role Architecture

## 1. Principle of Least Privilege

To ensure banking-grade security and prevent catastrophic operational failures, database administration, application execution, and compliance auditing must be strictly separated.

Under no circumstances should the application connect to PostgreSQL using `postgres` superuser credentials.

---

## 2. Role Taxonomy

| Role | Responsibility | Superuser? | DDL Permissions | DML Permissions |
|---|---|---|---|---|
| `ledgerline_owner` | Schema migration, table definition, trigger maintenance | NO | FULL on database `ledgerline` & schema `public` | SELECT, INSERT, UPDATE, DELETE |
| `ledgerline_app` | Runtime banking application service | NO | NONE | Restricted DML (No UPDATE/DELETE on ledger/audit) |
| `ledgerline_auditor` | Read-only regulatory auditing & reporting | NO | NONE | SELECT-only |

---

## 3. Privilege Matrix

| Table | `ledgerline_owner` | `ledgerline_app` | `ledgerline_auditor` |
|---|---|---|---|
| `users` | ALL | SELECT, INSERT, UPDATE | SELECT |
| `accounts` | ALL | SELECT, INSERT, UPDATE | SELECT |
| `financial_transactions` | ALL | SELECT, INSERT, UPDATE | SELECT |
| `idempotency_records` | ALL | SELECT, INSERT, UPDATE | SELECT |
| `ledger_entries` | ALL | **SELECT, INSERT only** (No UPDATE/DELETE) | SELECT |
| `audit_events` | ALL | **SELECT, INSERT only** (No UPDATE/DELETE) | SELECT |
| `_prisma_migrations` | ALL | SELECT only | SELECT |

---

## 4. Multi-Layer Ledger & Audit Protection

The immutability of `ledger_entries` and `audit_events` is defended across multiple architectural boundaries:

### Layer 1: PostgreSQL Privilege Control
The application role `ledgerline_app` is explicitly granted only `SELECT` and `INSERT` on `ledger_entries` and `audit_events`. Attempts to issue `UPDATE` or `DELETE` are rejected by PostgreSQL's permission system before executing any table scans.

### Layer 2: PostgreSQL Trigger Enforcement
Even if a role with elevated DML permissions issues an `UPDATE` or `DELETE`, PostgreSQL triggers `trg_ledger_entries_immutable` and `trg_audit_events_immutable` unconditionally intercept the operation and raise an exception with `SQLSTATE 55000`:
- `"Ledger entries are immutable; use a compensating transaction"`
- `"Audit events are immutable and append-only"`

### Layer 3: Application Authorization Barrier
Application-level administrative users (`user_role = 'ADMIN'`) operate within application business logic and have no direct access to PostgreSQL credentials, connection strings, or database DDL privileges.

---

## 5. Security Provisioning Script

The initialization script is maintained at `scripts/init-roles.sql`:

```sql
-- 1. Create Roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledgerline_owner') THEN
        CREATE ROLE ledgerline_owner WITH LOGIN PASSWORD 'change_owner_password_in_prod';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledgerline_app') THEN
        CREATE ROLE ledgerline_app WITH LOGIN PASSWORD 'change_app_password_in_prod';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledgerline_auditor') THEN
        CREATE ROLE ledgerline_auditor WITH LOGIN PASSWORD 'change_auditor_password_in_prod';
    END IF;
END $$;

-- 2. Database & Schema Ownership
ALTER DATABASE ledgerline OWNER TO ledgerline_owner;
GRANT ALL ON SCHEMA public TO ledgerline_owner;

-- 3. Revoke public access
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 4. Application Runtime Role Permissions
GRANT USAGE ON SCHEMA public TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE users TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE accounts TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE financial_transactions TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE idempotency_records TO ledgerline_app;
GRANT SELECT, INSERT ON TABLE ledger_entries TO ledgerline_app;
GRANT SELECT, INSERT ON TABLE audit_events TO ledgerline_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ledgerline_app;

-- 5. Auditor Role Permissions
GRANT USAGE ON SCHEMA public TO ledgerline_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ledgerline_auditor;
```

