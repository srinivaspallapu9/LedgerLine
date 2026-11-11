# BalanceVault (formerly LedgerLine) V1 — Database Architecture

## 1. Overview and Core Philosophy

BalanceVault is an enterprise banking and ledger platform designed with strict financial correctness, transaction integrity, concurrency safety, data consistency, and auditability.

### Fundamental Principles
1. **Never use floating-point types for currency**: All monetary values are strictly represented as `BIGINT` in the smallest currency unit: **Paise** (1 INR = 100 Paise).
2. **Double-Entry Accounting as Truth**: The `ledger_entries` table is the immutable, authoritative accounting record. Account `balance_paise` is a cached operational projection.
3. **Immutability of Historical Records**: Ledger entries and audit events are strictly append-only. In-place `UPDATE` or `DELETE` operations are blocked at the database engine level via triggers (`SQLSTATE 55000`).
4. **UUID Primary Identifiers**: Every record utilizes PostgreSQL UUIDs generated via `gen_random_uuid()` to prevent enumeration attacks and support distributed ingestion.
5. **Defense-in-Depth Validation**: System invariants are enforced at multiple levels: application typing (Prisma ORM), database check constraints, unique constraints, and PostgreSQL triggers (both immediate and deferred).

---

## 2. PostgreSQL Enums

| Enum Name | Allowed Values | Usage |
|---|---|---|
| `user_role` | `ADMIN`, `ACCOUNT_HOLDER`, `AUDITOR` | User authorization role |
| `account_type` | `CUSTOMER`, `SYSTEM` | Account categorization |
| `account_status` | `ACTIVE`, `FROZEN`, `CLOSED` | Account lifecycle state |
| `transaction_type` | `TRANSFER`, `DEPOSIT`, `WITHDRAWAL` | Business transaction classification |
| `transaction_status` | `PENDING`, `POSTED`, `FAILED`, `REVERSED` | Transaction workflow state |
| `entry_direction` | `DEBIT`, `CREDIT` | Double-entry ledger movement |

---

## 3. Data Dictionary

### 3.1. `users`
Represents customer identities, internal administrators, and system auditors.
- `id` (`UUID`, PK, `gen_random_uuid()`): Unique user ID.
- `full_name` (`VARCHAR(120)`, NOT NULL): Legal name.
- `email` (`VARCHAR(254)`, NOT NULL, UNIQUE): Normalized lowercase, trimmed email address.
- `password_hash` (`VARCHAR(255)`, NOT NULL): Argon2id or Bcrypt hashed password. Plaintext passwords are never stored.
- `role` (`user_role`, NOT NULL, DEFAULT `'ACCOUNT_HOLDER'`): User authorization role.
- `is_enabled` (`BOOLEAN`, NOT NULL, DEFAULT `TRUE`): Soft-disable switch for account lockouts.
- `created_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`): Record creation timestamp.
- `updated_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`): Automatic timestamp via `trg_users_updated_at`.

**Constraints & Integrity**:
- `uq_users_email`: Enforces email uniqueness.
- `ck_users_email_not_blank`: Rejects whitespace-only emails (`CHECK (length(trim(email)) > 0)`).
- `ck_users_email_normalized`: Enforces `email = lower(trim(email))`.
- Trigger `trg_users_normalize_email`: Automatically lowercases and trims email before insert or update.
- Foreign keys from all dependent financial tables specify `ON DELETE RESTRICT`, strictly preventing deletion of users with financial history (`SQLSTATE 23001`).

### 3.2. `accounts`
Represents customer checking/savings accounts and internal bank clearing/reserve accounts.
- `id` (`UUID`, PK, `gen_random_uuid()`): Unique account ID.
- `account_number` (`VARCHAR(32)`, NOT NULL, UNIQUE): Unique human-readable or IBAN/routing account identifier.
- `owner_user_id` (`UUID`, NULLABLE, FK -> `users(id)` ON DELETE RESTRICT): Account holder.
- `account_type` (`account_type`, NOT NULL, DEFAULT `'CUSTOMER'`): `CUSTOMER` vs `SYSTEM`.
- `status` (`account_status`, NOT NULL, DEFAULT `'ACTIVE'`): Operational status.
- `currency` (`CHAR(3)`, NOT NULL, DEFAULT `'INR'`): Fixed currency code.
- `balance_paise` (`BIGINT`, NOT NULL, DEFAULT `0`): Cached operational balance.
- `version` (`BIGINT`, NOT NULL, DEFAULT `0`): Optimistic concurrency control counter.
- `created_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`): Timestamp.
- `updated_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`): Managed via `trg_accounts_updated_at`.

**Constraints & Indexes**:
- `uq_accounts_account_number`: Unique account number.
- `ck_accounts_currency`: `currency = 'INR'`.
- `ck_accounts_balance`: `account_type = 'SYSTEM' OR balance_paise >= 0` (Customer balance can never be negative; internal system clearing accounts may carry negative balances depending on asset/liability direction).
- `ck_accounts_owner_type`: `(account_type = 'CUSTOMER' AND owner_user_id IS NOT NULL) OR (account_type = 'SYSTEM' AND owner_user_id IS NULL)`.
- `ck_accounts_version`: `version >= 0`.
- Partial Index `idx_accounts_owner_status`: `accounts(owner_user_id, status) WHERE account_type = 'CUSTOMER'`.

### 3.3. `financial_transactions`
Represents an atomic financial business event (e.g., peer-to-peer transfer, cash deposit, ATM withdrawal).
- `id` (`UUID`, PK, `gen_random_uuid()`): Transaction ID.
- `transaction_ref` (`VARCHAR(40)`, NOT NULL, UNIQUE): External or client-facing unique reference.
- `transaction_type` (`transaction_type`, NOT NULL): `TRANSFER`, `DEPOSIT`, `WITHDRAWAL`.
- `status` (`transaction_status`, NOT NULL, DEFAULT `'PENDING'`): Lifecycle status.
- `amount_paise` (`BIGINT`, NOT NULL): Gross transaction amount in paise (> 0).
- `currency` (`CHAR(3)`, NOT NULL, DEFAULT `'INR'`): Fixed currency code.
- `source_account_id` (`UUID`, NULLABLE, FK -> `accounts(id)` ON DELETE RESTRICT): Outflow account.
- `destination_account_id` (`UUID`, NULLABLE, FK -> `accounts(id)` ON DELETE RESTRICT): Inflow account.
- `initiated_by_user_id` (`UUID`, NULLABLE, FK -> `users(id)` ON DELETE RESTRICT): Operator or actor.
- `description` (`VARCHAR(250)`): Memo / narration.
- `failure_code` (`VARCHAR(60)`): Reason for failure if `status = 'FAILED'`.
- `created_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`): Creation timestamp.
- `posted_at` (`TIMESTAMPTZ`, NULLABLE): Final posted settlement timestamp.

**Constraints & Indexes**:
- `uq_financial_transactions_ref`: Unique reference.
- `ck_transactions_amount`: `amount_paise > 0`.
- `ck_transactions_currency`: `currency = 'INR'`.
- `ck_transactions_accounts`:
  - `TRANSFER`: Requires both `source_account_id` and `destination_account_id`, and `source_account_id <> destination_account_id`.
  - `DEPOSIT`: Requires `destination_account_id` and `source_account_id IS NULL`.
  - `WITHDRAWAL`: Requires `source_account_id` and `destination_account_id IS NULL`.
- `ck_transactions_posted_time`: `(status = 'POSTED' AND posted_at IS NOT NULL) OR (status <> 'POSTED' AND posted_at IS NULL)`.
- `ck_transactions_failure_code`: `(status = 'FAILED') OR (failure_code IS NULL)`.
- Indexes:
  - `idx_transactions_source_created` on `(source_account_id, created_at DESC)`
  - `idx_transactions_destination_created` on `(destination_account_id, created_at DESC)`
  - `idx_transactions_status_created` on `(status, created_at)`

### 3.4. `ledger_entries`
Immutable double-entry book entries.
- `id` (`UUID`, PK, `gen_random_uuid()`): Unique entry identifier.
- `transaction_id` (`UUID`, NOT NULL, FK -> `financial_transactions(id)` ON DELETE RESTRICT).
- `account_id` (`UUID`, NOT NULL, FK -> `accounts(id)` ON DELETE RESTRICT).
- `direction` (`entry_direction`, NOT NULL): `DEBIT` or `CREDIT`.
- `amount_paise` (`BIGINT`, NOT NULL): Nonzero amount in paise.
- `currency` (`CHAR(3)`, NOT NULL, DEFAULT `'INR'`).
- `created_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`).

**Constraints, Indexes & Triggers**:
- `ck_ledger_amount`: `amount_paise > 0`.
- `ck_ledger_currency`: `currency = 'INR'`.
- `idx_ledger_transaction`: `(transaction_id)`
- `idx_ledger_account_created`: `(account_id, created_at DESC)`
- Trigger `trg_ledger_entries_immutable`: Rejects any `UPDATE` or `DELETE` with `SQLSTATE 55000`.
- Trigger `trg_ledger_entries_prevent_post_entry`: Rejects adding entries to an already `POSTED` transaction.
- Deferred Constraint Trigger `ctrg_transaction_balanced_on_entries`: Validates balanced double-entry at transaction commit.

### 3.5. `idempotency_records`
Ensures that repeated client submissions (network retries, mobile disconnects) never result in duplicate financial execution.
- `id` (`UUID`, PK, `gen_random_uuid()`): Unique record ID.
- `user_id` (`UUID`, NOT NULL, FK -> `users(id)` ON DELETE RESTRICT): User owning the request scope.
- `idempotency_key` (`VARCHAR(128)`, NOT NULL): Client-provided key (e.g. UUIDv4).
- `request_hash` (`CHAR(64)`, NOT NULL): SHA-256 hash of the normalized request payload.
- `transaction_id` (`UUID`, NULLABLE, FK -> `financial_transactions(id)` ON DELETE RESTRICT).
- `response_status` (`SMALLINT`, NULLABLE): Cached HTTP status code (e.g., 200, 201).
- `response_body` (`JSONB`, NULLABLE): Cached response payload.
- `state` (`VARCHAR(20)`, NOT NULL, DEFAULT `'IN_PROGRESS'`): `'IN_PROGRESS'` or `'COMPLETED'`.
- `created_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`).
- `completed_at` (`TIMESTAMPTZ`, NULLABLE).

**Constraints & Indexes**:
- `uq_idempotency_user_key`: Unique `(user_id, idempotency_key)`.
- `ck_idempotency_state`: `state IN ('IN_PROGRESS', 'COMPLETED')`.
- `ck_idempotency_completion`: `(state = 'IN_PROGRESS' AND completed_at IS NULL) OR (state = 'COMPLETED' AND completed_at IS NOT NULL)`.
- `idx_idempotency_created`: `(created_at)`.

### 3.6. `audit_events`
Immutable security and operational event log.
- `id` (`UUID`, PK, `gen_random_uuid()`): Unique event ID.
- `actor_user_id` (`UUID`, NULLABLE, FK -> `users(id)` ON DELETE RESTRICT).
- `event_type` (`VARCHAR(80)`, NOT NULL): Event categorization (e.g., `AUTH_LOGIN`, `TRANSFER_SUBMITTED`).
- `resource_type` (`VARCHAR(80)`, NOT NULL): Entity type (`ACCOUNT`, `TRANSACTION`, `USER`).
- `resource_id` (`UUID`, NULLABLE): ID of targeted entity.
- `outcome` (`VARCHAR(20)`, NOT NULL): `'SUCCESS'`, `'FAILURE'`, `'DENIED'`.
- `correlation_id` (`UUID`, NULLABLE): Distributed trace ID.
- `ip_address` (`INET`, NULLABLE): Client IP address.
- `user_agent` (`VARCHAR(500)`, NULLABLE): Client user agent string.
- `details` (`JSONB`, NOT NULL, DEFAULT `'{}'::jsonb`): Structured sanitised context (no credentials or tokens).
- `occurred_at` (`TIMESTAMPTZ`, NOT NULL, DEFAULT `now()`).

**Constraints, Indexes & Triggers**:
- `ck_audit_outcome`: `outcome IN ('SUCCESS', 'FAILURE', 'DENIED')`.
- `idx_audit_actor_time`: `(actor_user_id, occurred_at DESC)`.
- `idx_audit_resource_time`: `(resource_type, resource_id, occurred_at DESC)`.
- `idx_audit_correlation`: `(correlation_id)`.
- Trigger `trg_audit_events_immutable`: Blocks `UPDATE` and `DELETE` on audit events (`SQLSTATE 55000`).

