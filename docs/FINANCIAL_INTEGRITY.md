# BalanceVault (formerly LedgerLine) V1 — Financial Integrity Specification

## 1. Core Financial Tenets

Financial software engineering requires zero tolerance for rounding discrepancies, floating-point drift, partial transactions, or retroactive ledger tampering. BalanceVault implements strict accounting controls directly inside the PostgreSQL database engine.

---

## 2. Monetary Precision: Integer Paise Representation

All financial calculations and database columns use 64-bit signed integers (`BIGINT`) representing values in **Paise** (100 Paise = 1 INR):
- **Never use IEEE 754 floating-point types (`FLOAT`, `DOUBLE`, `REAL`, JavaScript `number`)**: Floating-point representations introduce binary approximation errors (e.g., `0.1 + 0.2 === 0.30000000000000004`), which can cause cumulative ledger imbalance.
- **Explicit conversions**: All client inputs are parsed into integer Paise before any database query or transaction execution.
- Maximum representable value in `BIGINT`: 9,223,372,036,854,775,807 paise (approx. 9.22 × 10¹⁶ INR), providing more than sufficient headroom for national-scale banking volumes without overflow risk.

---

## 3. Double-Entry Accounting Model

Every posted financial event is recorded as a balanced set of ledger entries:
$$\sum \text{Debit Amounts} = \sum \text{Credit Amounts} = \text{Transaction Gross Amount}$$

### 3.1. Standard Posting Sequence
1. **Create Transaction**: Record inserted in `financial_transactions` with status `'PENDING'`.
2. **Append Ledger Entries**: For every leg of the movement, insert a row in `ledger_entries` with direction `DEBIT` or `CREDIT` referencing the pending transaction.
3. **Transition to POSTED**: Update `financial_transactions` to `status = 'POSTED'` and set `posted_at = now()`.
4. **Commit Validation**: The deferred constraint triggers execute automatically before the SQL `COMMIT` finalizes.

### 3.2. Deferred Constraint Triggers
Two constraint triggers are configured as `DEFERRABLE INITIALLY DEFERRED`:
- `ctrg_transaction_balanced_on_status`: Fires on `INSERT OR UPDATE` on `financial_transactions`.
- `ctrg_transaction_balanced_on_entries`: Fires on `INSERT` on `ledger_entries`.

Both execute the PL/pgSQL function `assert_posted_transaction_balanced()`:
```sql
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

    IF tx_status = 'POSTED' THEN
        SELECT
            COUNT(*),
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'DEBIT'), 0),
            COALESCE(SUM(amount_paise) FILTER (WHERE direction = 'CREDIT'), 0),
            COALESCE(COUNT(*) FILTER (WHERE currency <> tx_currency), 0)
        INTO entry_count, debit_total, credit_total, currency_mismatch_count
        FROM ledger_entries
        WHERE transaction_id = tx_id;

        IF entry_count < 2 THEN
            RAISE EXCEPTION 'Posted transaction % requires at least 2 ledger entries, found %', tx_id, entry_count
                USING ERRCODE = '23514';
        END IF;

        IF debit_total <> credit_total THEN
            RAISE EXCEPTION 'Posted transaction % is unbalanced: debit total (%) <> credit total (%)', tx_id, debit_total, credit_total
                USING ERRCODE = '23514';
        END IF;

        IF debit_total <= 0 OR debit_total <> tx_amount THEN
            RAISE EXCEPTION 'Posted transaction % amount (%) does not match ledger entry total (%)', tx_id, tx_amount, debit_total
                USING ERRCODE = '23514';
        END IF;

        IF currency_mismatch_count > 0 THEN
            RAISE EXCEPTION 'Posted transaction % has % ledger entries with mismatched currency', tx_id, currency_mismatch_count
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;
```

### 3.3. Handled Edge Cases
- **Zero-entry transaction**: Raising to `POSTED` without inserting entries fails with `23514`.
- **Single-entry transaction**: Fails with `23514` (minimum 2 entries required).
- **Debit/Credit sum mismatch**: Fails with `23514`.
- **Entries with mismatched currency**: Fails with `23514`.
- **Attempt to append entries after posting**: Blocked immediately by `trg_ledger_entries_prevent_post_entry` with `SQLSTATE 55000`.

---

## 4. Ledger Immutability & Compensating Transactions

### 4.1. The Immutability Trigger
No historical ledger entry may ever be altered or deleted. Trigger `trg_ledger_entries_immutable` runs `BEFORE UPDATE OR DELETE ON ledger_entries`:
```sql
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable; use a compensating transaction'
        USING ERRCODE = '55000';
END;
$$;
```

### 4.2. Handling Corrections and Errors
When a posted transaction must be corrected or refunded:
1. **Never edit existing rows**.
2. **Issue a Compensating Transaction**:
   - Create a new transaction with `status = 'PENDING'` and `transaction_type = 'TRANSFER'` (or appropriate compensating classification).
   - In the description/memo, reference the original transaction UUID.
   - Insert new compensating `ledger_entries` in the opposite direction (swapping debits and credits).
   - Mark the compensating transaction as `POSTED`.
   - Update original transaction `status = 'REVERSED'` if applicable.

---

## 5. Idempotency Architecture

Financial operations must withstand distributed network retries without duplicate ledger impact.

### 5.1. Concurrency and Uniqueness
- Scope: `UNIQUE (user_id, idempotency_key)`.
- SHA-256 Request Hash: Verifies that a repeated key matches the exact original request payload.

### 5.2. Atomic State Machine
```
[Client Request]
       │
       ▼
[INSERT idempotency_records state='IN_PROGRESS']
       │
       ├─ ON CONFLICT (user_id, idempotency_key)
       │       │
       │       ├─ If request_hash matches and state='COMPLETED' -> Replay cached response_body
       │       ├─ If request_hash differs -> Reject with HTTP 422 Unprocessable Entity
       │       └─ If state='IN_PROGRESS' -> Reject with HTTP 409 Conflict (Concurrent execution in progress)
       │
       ▼
[Execute Financial Business Logic inside Transaction]
       │
       ▼
[UPDATE idempotency_records SET state='COMPLETED', completed_at=now(), response_body=...]
       │
       ▼
[COMMIT]
```

Database check constraint `ck_idempotency_completion` ensures that:
- `IN_PROGRESS` strictly requires `completed_at IS NULL`.
- `COMPLETED` strictly requires `completed_at IS NOT NULL`.

---

## 6. Operational Balance vs Accounting Truth

- `accounts.balance_paise`: Operational cached projection used for low-latency balance lookups.
- `ledger_entries`: Authoritative accounting book of record.
- **Reconciliation Invariant**: For any account, the calculated balance:
  $$\text{Ledger Balance} = \sum_{\text{CREDIT}} \text{amount\_paise} - \sum_{\text{DEBIT}} \text{amount\_paise}$$
  (adjusted for customer liability perspective where customer deposit is credit, withdrawal is debit).
- Operational balance updates must only occur within the same serializable or read-committed row-locked transaction (`SELECT FOR UPDATE`) as the ledger entry creation.

