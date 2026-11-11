# BalanceVault — Secure Digital Banking & Ledger System

BalanceVault (formerly LedgerLine) is a digital banking application focused on financial transaction integrity, double-entry accounting, role-based access control, idempotency, and auditability.

## Project Overview

| Component | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| ORM | Prisma ORM 6.x |
| Database | PostgreSQL 15+ |
| Authentication | JWT-based authentication |
| Password Hashing | bcrypt |
| Frontend Deployment | Vercel |
| Backend Deployment | Render |
| Database Hosting | Neon PostgreSQL |

**Currency:** INR  
**Smallest Currency Unit:** Paise  
**Financial Amount Representation:** BIGINT  
**Primary Identifiers:** UUID  

## Live Application

- **Frontend:** https://ledger-line-liart.vercel.app
- **GitHub Repository:** https://github.com/srinivasapallapu9/LedgerLine
- **Backend:** Hosted on Render
- **Database:** Hosted on Neon PostgreSQL

## Features

### Customer
- User registration and authentication
- Customer account management
- Deposits and withdrawals
- Customer-to-customer transfers
- Transaction history

### Administrator
- Administrator authentication
- Account management
- Account status management
- Administrative access to application operations

### Auditor
- Separate auditor role
- Read-only financial review capabilities
- Transaction and audit information access according to implemented permissions

### Financial Integrity
- Double-entry ledger accounting
- Paise-based financial amounts
- PostgreSQL transaction processing
- Transaction idempotency
- Concurrency-aware financial operations
- Audit event recording
- Database constraints and triggers for financial integrity

## Architecture

```text
                 ┌──────────────────────┐
                 │      Customer        │
                 │   Administrator      │
                 │       Auditor        │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   React Frontend    │
                 │       Vercel        │
                 └──────────┬───────────┘
                            │ HTTPS
                            ▼
                 ┌──────────────────────┐
                 │   Express REST API  │
                 │       Render        │
                 └──────────┬───────────┘
                            │ Prisma
                            ▼
                 ┌──────────────────────┐
                 │ PostgreSQL Database │
                 │        Neon         │
                 └──────────────────────┘
```

## Local Development Setup

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL 15+
- Git

### 1. Clone the repository

```bash
git clone https://github.com/srinivasapallapu9/LedgerLine.git
cd LedgerLine
```

### 2. Install backend dependencies

```bash
npm install
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Configure environment variables

Copy `.env.example` to `.env` and configure the required environment variables.

Example local PostgreSQL configuration:

```env
LOCAL_DATABASE_URL="postgresql://postgres:root@localhost:5432/ledgerline?schema=public"
TEST_DATABASE_URL="postgresql://postgres:root@localhost:5432/ledgerline_test?schema=public"
```

Configure `DATABASE_URL`, `DIRECT_URL`, and the required authentication configuration according to the project's environment setup.

Never commit actual database credentials, JWT secrets, or passwords.

### 5. Generate Prisma Client

```bash
npx prisma generate
```

### 6. Apply database migrations

```bash
npm run db:migrate
```

### 7. Initialize system accounts

```bash
npm run db:seed
```

### 8. Provision a local administrator

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your local `.env`.

The password must contain at least 12 characters.

```bash
npm run admin:provision
```

The provisioning script does not promote an existing customer to administrator.

### 9. Start the backend

```bash
npm start
```

### 10. Start the frontend

In a separate terminal:

```bash
cd frontend
npm run dev
```

Configure the frontend API URL to point to your local backend.

## Available Scripts

| Command | Description |
|---|---|
| `npm start` | Start backend |
| `npm run dev` | Start backend in development mode |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Initialize system accounts |
| `npm run admin:provision` | Provision administrator |
| `npm run test:admin` | Run administrator provisioning tests |
| `npm run test:transfer-unit` | Run transfer unit tests |
| `npm run test:engine` | Run engine tests |
| `npm run test:api` | Run API integration tests |
| `npm test` | Run configured test suite |

**Warning:** Integration tests may reset test database data. Always verify that `TEST_DATABASE_URL` points to a disposable test database before executing tests.

## Database Structure

The core database contains:

- `users`
- `accounts`
- `financial_transactions`
- `ledger_entries`
- `idempotency_records`
- `audit_events`

### Financial Accounting

Financial amounts are stored in paise using PostgreSQL BIGINT.

Example:

```text
₹100.00 = 10000 paise
```

This avoids floating-point precision errors in financial calculations.

### Transaction Integrity

The application uses transaction processing, ledger entries, database constraints, and idempotency mechanisms to support reliable financial operations.

Ledger and audit records are intended to preserve transaction history and traceability.

## Security

- Password hashing with bcrypt
- Authentication using JWT
- Role-based access control
- Customer, administrator, and auditor roles
- Database constraints
- Transaction idempotency
- Audit event recording
- Environment-based configuration
- Separation of development and production environments

## Deployment

BalanceVault is deployed using:

- **Vercel:** React frontend
- **Render:** Express backend
- **Neon:** PostgreSQL database

Production environment variables are configured through the respective hosting platforms.

Never include production credentials in the repository.

## Project Documentation

Additional technical documentation:

- [Database Architecture](docs/DATABASE_ARCHITECTURE.md)
- [Financial Integrity](docs/FINANCIAL_INTEGRITY.md)
- [Database Security](docs/DATABASE_SECURITY.md)
- [Migration Verification Report](docs/MIGRATION_VERIFICATION_REPORT.md)
- [AI Usage & Development Prompts](PROMPTS.md)
- [Threat Model](THREATS.md)

## Responsible AI Usage

AI tools were used during development for implementation assistance, debugging, architecture discussions, documentation, and deployment troubleshooting.

AI-generated suggestions were reviewed and tested. Incorrect approaches were investigated and corrected during development.

See `PROMPTS.md` for the development interaction record.

## Limitations

BalanceVault is a project demonstration and evaluation application. It is not a regulated banking system and is not intended to process real customer funds.

Further security testing, monitoring, operational hardening, and independent review would be required before any real financial deployment.

## Author

**Srinivas Pallapu**

GitHub: https://github.com/srinivasapallapu9
