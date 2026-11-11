-- BalanceVault / LedgerLine Database Security & Role Configuration
-- Implements separation of duties: Migration Owner, Application Runtime, and Read-Only Auditor.

-- 1. Create Roles (passwords should be overridden per deployment environment)
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

-- 3. Revoke dangerous defaults from PUBLIC
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 4. Application Runtime Role Permissions (Least Privilege)
-- Allows transactional updates on mutable entities, strictly blocks UPDATE/DELETE on ledger & audit tables.
GRANT USAGE ON SCHEMA public TO ledgerline_app;

-- Mutable application tables
GRANT SELECT, INSERT, UPDATE ON TABLE users TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE accounts TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE financial_transactions TO ledgerline_app;
GRANT SELECT, INSERT, UPDATE ON TABLE idempotency_records TO ledgerline_app;

-- Append-only / Immutable tables (NO UPDATE, NO DELETE)
GRANT SELECT, INSERT ON TABLE ledger_entries TO ledgerline_app;
GRANT SELECT, INSERT ON TABLE audit_events TO ledgerline_app;

-- Allow executing trigger functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ledgerline_app;

-- 5. Read-Only Auditor Role Permissions
GRANT USAGE ON SCHEMA public TO ledgerline_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ledgerline_auditor;

-- Ensure future tables respect read-only for auditor
ALTER DEFAULT PRIVILEGES FOR ROLE ledgerline_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO ledgerline_auditor;

