# BalanceVault (formerly LedgerLine) V1 — Core Financial Engine

BalanceVault is a banking-grade financial platform engineered for transactional integrity, double-entry accounting, strict immutability, concurrency safety, and auditability.

Currency: **INR**  
Smallest Unit: **Paise** (Represented as `BIGINT`, never floating-point)  
Primary Identifiers: **UUID** (`gen_random_uuid()`)  
Database: **PostgreSQL 15+**  
ORM: **Prisma ORM (v6.x)**

---

## 1. Quickstart

### Prerequisites
- Node.js 18+ (tested on Node v22.x)
- PostgreSQL 15+ (tested on PostgreSQL 18.6)
- npm or pnpm

### Setup Instructions

1. **Clone and Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Configure your PostgreSQL connection strings:
   ```env
   DATABASE_URL="postgresql://postgres:root@localhost:5432/ledgerline?schema=public"
   TEST_DATABASE_URL="postgresql://postgres:root@localhost:5432/ledgerline_test?schema=public"
   ```

3. **Deploy Database Migrations**:
   Deploy the financial schema, enums, triggers, and constraints using Prisma:
   ```bash
   npm run db:migrate
   ```

4. **Seed Internal System Accounts**:
   Populate internal clearing accounts (this does not create or reset an administrator):
   ```bash
   npm run db:seed
   ```

5. **Provision a Local Administrator**:
   Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your local, git-ignored `.env` file. Use a unique password of at least 12 characters; do not commit it or put it in source control. Then run:
   ```bash
   npm run admin:provision
   ```
   A new administrator is created only if the email is unused. If that email already belongs to an administrator, the script leaves its credentials unchanged. To reset that administrator's password, run `npm run admin:provision -- --reset-existing` in an interactive terminal and type the exact administrator email when prompted. An existing non-admin user is never promoted by this script.

   Sign in through the frontend using the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD`. There is no hard-coded demo login.

6. **Run Automated Integration Tests**:
   The provisioning and registration authorization tests do not connect to a database:
   ```bash
   npm run test:admin
   ```
   The full integration suites use a database and reset test data. Verify that `TEST_DATABASE_URL` points to a disposable test database before running:
   ```bash
   npm test
   ```

---

## 2. Project Structure

```
├── prisma/
│   ├── schema.prisma              # Complete Prisma Schema with Enums and Models
│   ├── seed.ts                    # Bootstrap script for system accounts & admin
│   └── migrations/
│       └── 20261110000000_init_core_financial_schema/
│           └── migration.sql      # Core PostgreSQL DDL, triggers, and constraints
├── tests/
│   ├── test-helper.ts             # Test database isolation and connection pooling
│   ├── run-all-tests.ts           # Comprehensive 36-test integration suite
│   └── prisma-client.test.ts      # Prisma Client ORM relational test
├── scripts/
│   └── init-roles.sql             # Least-privilege role setup (owner, app, auditor)
├── docs/
│   ├── DATABASE_ARCHITECTURE.md   # Data dictionary, tables, enums, indexes
│   ├── FINANCIAL_INTEGRITY.md     # Double-entry triggers, immutability, idempotency
│   ├── DATABASE_SECURITY.md       # Security plan, roles, grants, ledger protection
│   └── MIGRATION_VERIFICATION_REPORT.md # Verification report & test audit logs
├── backend/                       # Existing Spring Boot backend scaffold
└── package.json                   # NPM configuration & scripts
```

---

## 3. Database Security Setup

To provision least-privilege PostgreSQL roles (separating migration owner, application runtime, and read-only auditor):

```bash
psql -U postgres -h localhost -p 5432 -d ledgerline -f scripts/init-roles.sql
```

The application connects using `ledgerline_app`, which is granted restricted DML and explicitly denied `UPDATE` and `DELETE` on `ledger_entries` and `audit_events`.

---

## 4. Documentation

For deep technical specifications, refer to the documentation in `docs/`:
- [Database Architecture](docs/DATABASE_ARCHITECTURE.md)
- [Financial Integrity & Accounting Rules](docs/FINANCIAL_INTEGRITY.md)
- [Database Security Plan](docs/DATABASE_SECURITY.md)
- [Migration Verification Report](docs/MIGRATION_VERIFICATION_REPORT.md)
