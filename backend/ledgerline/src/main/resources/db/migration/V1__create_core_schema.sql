-- LedgerLine V1: Core financial schema
-- PostgreSQL 15+ recommended.
-- Application-generated UUIDs are supported; gen_random_uuid() is also available.

CREATE TYPE user_role AS ENUM ('ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR');
CREATE TYPE account_type AS ENUM ('CUSTOMER', 'SYSTEM');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE transaction_type AS ENUM ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED');
CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');

-- Identity and access
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(120) NOT NULL,
    email           VARCHAR(254) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'ACCOUNT_HOLDER',
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_email_not_blank CHECK (length(trim(email)) > 0)
);

-- Customer accounts and internal system accounts.
-- balance_paise is a cached/operational balance; the ledger remains the accounting record.
CREATE TABLE accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number      VARCHAR(32) NOT NULL,
    owner_user_id       UUID REFERENCES users(id) ON DELETE RESTRICT,
    account_type        account_type NOT NULL DEFAULT 'CUSTOMER',
    status              account_status NOT NULL DEFAULT 'ACTIVE',
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    balance_paise       BIGINT NOT NULL DEFAULT 0,
    version             BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_accounts_account_number UNIQUE (account_number),
    CONSTRAINT ck_accounts_currency CHECK (currency = 'INR'),
    CONSTRAINT ck_accounts_balance CHECK (
        account_type = 'SYSTEM' OR balance_paise >= 0
    ),
    CONSTRAINT ck_accounts_owner_type CHECK (
        (account_type = 'CUSTOMER' AND owner_user_id IS NOT NULL)
        OR (account_type = 'SYSTEM' AND owner_user_id IS NULL)
    ),
    CONSTRAINT ck_accounts_version CHECK (version >= 0)
);

CREATE INDEX idx_accounts_owner_status ON accounts(owner_user_id, status)
    WHERE account_type = 'CUSTOMER';

-- One business operation (transfer/deposit/withdrawal).
CREATE TABLE financial_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref     VARCHAR(40) NOT NULL,
    transaction_type    transaction_type NOT NULL,
    status              transaction_status NOT NULL DEFAULT 'PENDING',
    amount_paise        BIGINT NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    source_account_id   UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    destination_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    initiated_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    description         VARCHAR(250),
    failure_code        VARCHAR(60),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at           TIMESTAMPTZ,
    CONSTRAINT uq_financial_transactions_ref UNIQUE (transaction_ref),
    CONSTRAINT ck_transactions_amount CHECK (amount_paise > 0),
    CONSTRAINT ck_transactions_currency CHECK (currency = 'INR'),
    CONSTRAINT ck_transactions_accounts CHECK (
        (transaction_type = 'TRANSFER'
            AND source_account_id IS NOT NULL
            AND destination_account_id IS NOT NULL
            AND source_account_id <> destination_account_id)
        OR
        (transaction_type = 'DEPOSIT'
            AND source_account_id IS NULL
            AND destination_account_id IS NOT NULL)
        OR
        (transaction_type = 'WITHDRAWAL'
            AND source_account_id IS NOT NULL
            AND destination_account_id IS NULL)
    ),
    CONSTRAINT ck_transactions_posted_time CHECK (
        (status = 'POSTED' AND posted_at IS NOT NULL)
        OR (status <> 'POSTED' AND posted_at IS NULL)
    )
);

CREATE INDEX idx_transactions_source_created
    ON financial_transactions(source_account_id, created_at DESC);
CREATE INDEX idx_transactions_destination_created
    ON financial_transactions(destination_account_id, created_at DESC);
CREATE INDEX idx_transactions_status_created
    ON financial_transactions(status, created_at);

-- Immutable accounting entries. Every posted transaction must have balanced entries.
CREATE TABLE ledger_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL REFERENCES financial_transactions(id) ON DELETE RESTRICT,
    account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    direction           entry_direction NOT NULL,
    amount_paise        BIGINT NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_ledger_amount CHECK (amount_paise > 0),
    CONSTRAINT ck_ledger_currency CHECK (currency = 'INR')
);

CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_account_created ON ledger_entries(account_id, created_at DESC);

-- Idempotency scope is per authenticated user + key.
CREATE TABLE idempotency_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key     VARCHAR(128) NOT NULL,
    request_hash        CHAR(64) NOT NULL,
    transaction_id      UUID REFERENCES financial_transactions(id) ON DELETE RESTRICT,
    response_status     SMALLINT,
    response_body       JSONB,
    state               VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    CONSTRAINT uq_idempotency_user_key UNIQUE (user_id, idempotency_key),
    CONSTRAINT ck_idempotency_state CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT ck_idempotency_completion CHECK (
        (state = 'IN_PROGRESS' AND completed_at IS NULL)
        OR (state = 'COMPLETED' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX idx_idempotency_created ON idempotency_records(created_at);

-- Security and operational audit events (not the accounting ledger).
CREATE TABLE audit_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id       UUID REFERENCES users(id) ON DELETE RESTRICT,
    event_type          VARCHAR(80) NOT NULL,
    resource_type       VARCHAR(80) NOT NULL,
    resource_id         UUID,
    outcome             VARCHAR(20) NOT NULL,
    correlation_id      UUID,
    ip_address          INET,
    user_agent          VARCHAR(500),
    details             JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_audit_outcome CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED'))
);

CREATE INDEX idx_audit_actor_time ON audit_events(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_resource_time ON audit_events(resource_type, resource_id, occurred_at DESC);
CREATE INDEX idx_audit_correlation ON audit_events(correlation_id);

-- Prevent mutation/deletion of ledger entries. Corrections must use compensating entries.
CREATE FUNCTION prevent_ledger_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable; use a compensating transaction'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

-- Deferred check: at commit, every POSTED transaction must have >= 2 entries
-- and equal debit/credit totals. This allows entries to be inserted in the same
-- SQL transaction before the final commit.
CREATE FUNCTION assert_posted_transaction_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    tx_id UUID;
    tx_status transaction_status;
    debit_total NUMERIC;
    credit_total NUMERIC;
    entry_count BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'ledger_entries' THEN
        tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
    ELSE
        tx_id := NEW.id;
    END IF;

    SELECT status INTO tx_status
    FROM financial_transactions
    WHERE id = tx_id;

    IF tx_status = 'POSTED' THEN
        SELECT
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'DEBIT'), 0),
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'CREDIT'), 0),
            COUNT(*)
        INTO debit_total, credit_total, entry_count
        FROM ledger_entries
        WHERE transaction_id = tx_id;

        IF entry_count < 2 OR debit_total <> credit_total THEN
            RAISE EXCEPTION
                'Posted transaction % is unbalanced (entries %, debits %, credits %)',
                tx_id, entry_count, debit_total, credit_total
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ctrg_transaction_balanced_on_status
AFTER INSERT OR UPDATE ON financial_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_posted_transaction_balanced();

CREATE CONSTRAINT TRIGGER ctrg_transaction_balanced_on_entries
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_posted_transaction_balanced();
