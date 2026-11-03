# Loan Planner

A private Cloudflare Worker application for maintaining multiple family-loan amortization schedules. Cloudflare Access authenticates each visitor, D1 stores loan assignments and payment ledgers, and the Worker enforces per-loan permissions.

## Roles and permissions

- The owner can create loans, change terms, assign users, change status, and void or restore ledger entries.
- Assigned borrowers can view their loans, record extra or manual payments, and mark scheduled payments missed.
- Unassigned users cannot retrieve loan data.

Payment records are voided rather than deleted so their audit history remains available. Future amortization rows are calculated in the browser rather than stored.

## D1 setup

For a new database:

```sh
npm install
npm run db:create
npm run db:migrate:remote
npm run db:migrate:multi-loan:remote
```

For the original single-loan production database, apply only `migrations/0002_multi_loan.sql`. It migrates the existing loan to **Kat's Policy Loan**, assigns `katsmith430@gmail.com`, and attaches every existing payment event to that loan.

## Deployment

Cloudflare Workers Builds deploys `main` with `npx wrangler deploy`. The Wrangler configuration includes the D1 binding, static assets, owner email, and `loan.traderclay.com` custom domain.

Protect all Worker traffic with Cloudflare Access. Keep a dedicated Loan Planner Access policy containing every email that should be able to reach the application. Loan assignments in D1 provide the second authorization layer and control which records each signed-in user can retrieve.

## Calculation convention

The nominal annual rate is divided by the selected payment periods per year. Extra and manual payments are applied on the first scheduled payment date on or after their recorded date. A missed-payment marker disables that scheduled payment and leaves unpaid interest in the balance.

This is a planning tool. Confirm the lender's conventions before relying on its results.
