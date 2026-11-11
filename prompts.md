# PROMPTS.md — AI Usage Log

Project: BalanceVault / LedgerLine  
Developer: Srinivas Pallapu

This document records AI-assisted development. Prompt descriptions below are summaries, not necessarily verbatim prompts. Commit URLs must point to actual Git commits.

## Entry 1 — Database Architecture and Migration

**Date:** 2026-11-10  
**Prompt summary:** Help implement the financial database schema using Prisma and PostgreSQL, including accounts, transactions, ledger entries, users, roles, and audit records.

**AI assistance:** Schema design, migration review, database constraints, and architecture documentation.

**What I verified/did:** Reviewed the Prisma schema and migration, then applied the migration to Neon PostgreSQL.

**What required correction:** Database migration success alone does not prove transaction correctness or security. Those require separate verification.

**Commit:** TODO — insert actual commit URL.

## Entry 2 — Production Deployment

**Date:** 2026-11-11  
**Prompt summary:** Help deploy the frontend and backend using Vercel, Render, and Neon.

**AI assistance:** Deployment configuration, API URL troubleshooting, and environment-variable guidance.

**Issue discovered:** The frontend initially used a relative `/api` URL, which did not correctly target the deployed backend.

**Correction:** Configured the frontend API base URL using the deployed backend URL through an environment variable.

**Verification:** Confirmed the deployment and investigated API responses.

**Commit:** TODO — insert actual commit URL.

## Entry 3 — Administrator Provisioning

**Date:** 2026-11-12  
**Prompt summary:** Help provision an administrator securely without public administrator registration.

**AI assistance:** Reviewed the administrator provisioning workflow and password requirements.

**Implementation:** Used the existing `admin:provision` script.

**Verification:** Executed the provisioning command and received confirmation that the administrator was created.

**Security consideration:** Administrator credentials must not be committed, exposed in frontend code, or shared publicly.

**Commit:** TODO — insert actual commit URL.

## Entry 4 — Role-Based Access Control and Auditor

**Date:** 2026-11-12  
**Prompt summary:** Help configure an auditor account and understand auditor access.

**AI assistance:** Guidance on auditor provisioning and role-based authorization.

**Verification required:** Confirm that auditor access is enforced by backend authorization, not merely by hiding frontend controls. Verify that auditor endpoints cannot perform financial mutations.

**Security consideration:** An auditor should have read-only access to permitted financial records and audit events.

**Commit:** TODO — insert actual commit URL.

## Entry 5 — Production Authentication Troubleshooting

**Date:** 2026-11-12  
**Prompt summary:** Help troubleshoot production authentication and administrator login.

**AI assistance:** Investigated frontend API configuration, backend authentication responses, and administrator provisioning.

**Observed issue:** Authentication failures must be diagnosed separately from deployment availability. A healthy API does not automatically mean credentials or authorization are correct.

**Correction/verification:** Checked the deployed API configuration and provisioned the administrator through the server-side script.

**Commit:** TODO — insert actual commit URL.

---

## Responsible AI Usage

- AI was used for assistance with implementation, debugging, documentation, and security reasoning.
- Generated code was reviewed and tested where possible.
- AI output was not treated as proof of correctness.
- Security-sensitive behavior requires independent verification.
- Actual commit URLs should be added for the corresponding implementation changes.
- This log must be updated honestly as development continues.
