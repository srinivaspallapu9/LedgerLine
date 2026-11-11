-- BalanceVault (LedgerLine) V1: Core Financial Schema Migration
-- Target Engine: PostgreSQL 15+

-- 1. ENUMS
CREATE TYPE user_role AS ENUM ('ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR');
CREATE TYPE account_type AS ENUM ('CUSTOMER', 'SYSTEM');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE transaction_type AS ENUM ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED');
CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');

-- 2. USERS TABLE
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
    CONSTRAINT ck_users_email_not_blank CHECK (length(trim(email)) > 0),
    CONSTRAINT ck_users_email_normalized CHECK (email = lower(trim(email)))
);

-- 3. ACCOUNTS TABLE
-- balance_paise is a cached operational balance; the ledger is the source of truth.
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

-- 4. FINANCIAL TRANSACTIONS TABLE
CREATE TABLE financial_transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_ref         VARCHAR(40) NOT NULL,
    transaction_type        transaction_type NOT NULL,
    status                  transaction_status NOT NULL DEFAULT 'PENDING',
    amount_paise            BIGINT NOT NULL,
    currency                CHAR(3) NOT NULL DEFAULT 'INR',
    source_account_id       UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    destination_account_id  UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    initiated_by_user_id    UUID REFERENCES users(id) ON DELETE RESTRICT,
    description             VARCHAR(250),
    failure_code            VARCHAR(60),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at               TIMESTAMPTZ,
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
    ),
    CONSTRAINT ck_transactions_failure_code CHECK (
        (status = 'FAILED') OR (failure_code IS NULL)
    )
);

CREATE INDEX idx_transactions_source_created
    ON financial_transactions(source_account_id, created_at DESC);
CREATE INDEX idx_transactions_destination_created
    ON financial_transactions(destination_account_id, created_at DESC);
CREATE INDEX idx_transactions_status_created
    ON financial_transactions(status, created_at);

-- 5. LEDGER ENTRIES TABLE
-- Immutable financial records enforcing double-entry accounting.
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

-- 6. IDEMPOTENCY RECORDS TABLE
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

-- 7. AUDIT EVENTS TABLE
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

-- 8. IMMUTABILITY TRIGGER: LEDGER ENTRIES
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable; use a compensating transaction'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

-- 9. IMMUTABILITY TRIGGER: AUDIT EVENTS
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are immutable and append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

-- 10. PROTECTION AGAINST APPENDING LEDGER ENTRIES TO ALREADY POSTED TRANSACTIONS
CREATE OR REPLACE FUNCTION prevent_ledger_entry_on_posted_transaction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    parent_status transaction_status;
BEGIN
    SELECT status INTO parent_status
    FROM financial_transactions
    WHERE id = NEW.transaction_id;

    IF parent_status = 'POSTED' THEN
        RAISE EXCEPTION 'Cannot insert ledger entry into already POSTED transaction %', NEW.transaction_id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_entries_prevent_post_entry
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_on_posted_transaction();

-- 11. DEFERRED DOUBLE-ENTRY BALANCING CONSTRAINT TRIGGER
CREATE OR REPLACE FUNCTION assert_posted_transaction_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    tx_id UUID;
    tx_status transaction_status;
    tx_currency CHAR(3);
    tx_amount BIGINT;
    debit_total NUMERIC;
    credit_total NUMERIC;
    entry_count BIGINT;
    currency_mismatch_count BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'ledger_entries' THEN
        tx_id := NEW.transaction_id;
    ELSE
        tx_id := NEW.id;
    END IF;

    SELECT status, currency, amount_paise
    INTO tx_status, tx_currency, tx_amount
    FROM financial_transactions
    WHERE id = tx_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Only validate double-entry balance for POSTED transactions
    IF tx_status = 'POSTED' THEN
        SELECT
            COUNT(*),
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'DEBIT'), 0),
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'CREDIT'), 0),
            COALESCE(COUNT(*) FILTER (WHERE currency <> tx_currency), 0)
        INTO entry_count, debit_total, credit_total, currency_mismatch_count
        FROM ledger_entries
        WHERE transaction_id = tx_id;

        -- At least two entries required
        IF entry_count < 2 THEN
            RAISE EXCEPTION
                'Posted transaction % requires at least 2 ledger entries, found %',
                tx_id, entry_count
                USING ERRCODE = '23514';
        END IF;

        -- Debit total must equal Credit total
        IF debit_total <> credit_total THEN
            RAISE EXCEPTION
                'Posted transaction % is unbalanced: debit total (%) <> credit total (%)',
                tx_id, debit_total, credit_total
                USING ERRCODE = '23514';
        END IF;

        -- Both totals must be positive and equal transaction amount
        IF debit_total <= 0 OR debit_total <> tx_amount THEN
            RAISE EXCEPTION
                'Posted transaction % amount (%) does not match ledger entry total (%)',
                tx_id, tx_amount, debit_total
                USING ERRCODE = '23514';
        END IF;

        -- Mismatched currencies strictly prohibited
        IF currency_mismatch_count > 0 THEN
            RAISE EXCEPTION
                'Posted transaction % has % ledger entries with mismatched currency',
                tx_id, currency_mismatch_count
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

-- 12. EMAIL NORMALIZATION TRIGGER
CREATE OR REPLACE FUNCTION normalize_user_email()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.email := lower(trim(NEW.email));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_normalize_email
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION normalize_user_email();

-- 13. AUTOMATIC UPDATED_AT TIMESTAMP TRIGGERS
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_accounts_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

